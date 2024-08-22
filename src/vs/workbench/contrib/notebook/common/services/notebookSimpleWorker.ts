/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ISequence, LcsDiff } from '../../../../../base/common/diff/diff';
import { doHash, hash, numberHash } from '../../../../../base/common/hash';
import { IDisposable } from '../../../../../base/common/lifecycle';
import { URI } from '../../../../../base/common/uri';
import { IRequestHandler, IWorkerServer } from '../../../../../base/common/worker/simpleWorker';
import * as model from '../../../../../editor/common/model';
import { PieceTreeTextBufferBuilder } from '../../../../../editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { CellKind, ICellDto2, IMainCellDto, INotebookDiffResult, IOutputDto, NotebookCellInternalMetadata, NotebookCellMetadata, NotebookCellsChangedEventDto, NotebookCellsChangeType, NotebookCellTextModelSplice, NotebookData, NotebookDocumentMetadata } from '../notebookCommon';
import { Range } from '../../../../../editor/common/core/range';
import { VSBuffer } from '../../../../../base/common/buffer';
import { SearchParams } from '../../../../../editor/common/model/textModelSearch';

function bufferHash(buffer: VSBuffer): number {
	let initialHashVal = numberHash(104579, 0);
	for (let k = 0; k < buffer.buffer.length; k++) {
		initialHashVal = doHash(buffer.buffer[k], initialHashVal);
	}

	return initialHashVal;
}

class MirrorCell {
	private _textBuffer!: model.IReadonlyTextBuffer;

	get textBuffer() {
		if (this._textBuffer) {
			return this._textBuffer;
		}

		const builder = new PieceTreeTextBufferBuilder();
		builder.acceptChunk(Array.isArray(this._source) ? this._source.join('\n') : this._source);
		const bufferFactory = builder.finish(true);
		this._textBuffer = bufferFactory.create(model.DefaultEndOfLine.LF).textBuffer;

		return this._textBuffer;
	}

	private _primaryKey?: number | null = null;
	primaryKey(): number | null {
		if (this._primaryKey === undefined) {
			this._primaryKey = hash(this.getValue());
		}

		return this._primaryKey;
	}

	private _hash: number | null = null;

	constructor(
		readonly handle: number,
		private _source: string | string[],
		public language: string,
		public cellKind: CellKind,
		public outputs: IOutputDto[],
		public metadata?: NotebookCellMetadata,
		public internalMetadata?: NotebookCellInternalMetadata,

	) { }

	getFullModelRange() {
		const lineCount = this.textBuffer.getLineCount();
		return new Range(1, 1, lineCount, this.textBuffer.getLineLength(lineCount) + 1);
	}

	getValue(): string {
		const fullRange = this.getFullModelRange();
		return this.textBuffer.getValueInRange(fullRange, model.EndOfLinePreference.LF);
	}

	getComparisonValue(): number {
		if (this._primaryKey !== null) {
			return this._primaryKey!;
		}

		this._hash = hash([hash(this.language), hash(this.getValue()), this.metadata, this.internalMetadata, this.outputs.map(op => ({
			outputs: op.outputs.map(output => ({
				mime: output.mime,
				data: bufferHash(output.data)
			})),
			metadata: op.metadata
		}))]);
		return this._hash;
	}

	getHashValue() {
		if (this._hash !== null) {
			return this._hash;
		}

		this._hash = hash([hash(this.getValue()), this.language, this.metadata, this.internalMetadata]);
		return this._hash;
	}
}

class MirrorNotebookDocument {
	constructor(
		readonly uri: URI,
		public cells: MirrorCell[],
		public metadata: NotebookDocumentMetadata,
	) {
	}

	acceptModelChanged(event: NotebookCellsChangedEventDto) {
		// note that the cell content change is not applied to the MirrorCell
		// but it's fine as if a cell content is modified after the first diff, its position will not change any more
		// TODO@rebornix, but it might lead to interesting bugs in the future.
		event.rawEvents.forEach(e => {
			if (e.kind === NotebookCellsChangeType.ModelChange) {
				this._spliceNotebookCells(e.changes);
			} else if (e.kind === NotebookCellsChangeType.Move) {
				const cells = this.cells.splice(e.index, 1);
				this.cells.splice(e.newIdx, 0, ...cells);
			} else if (e.kind === NotebookCellsChangeType.Output) {
				const cell = this.cells[e.index];
				cell.outputs = e.outputs;
			} else if (e.kind === NotebookCellsChangeType.ChangeCellLanguage) {
				this._assertIndex(e.index);
				const cell = this.cells[e.index];
				cell.language = e.language;
			} else if (e.kind === NotebookCellsChangeType.ChangeCellMetadata) {
				this._assertIndex(e.index);
				const cell = this.cells[e.index];
				cell.metadata = e.metadata;
			} else if (e.kind === NotebookCellsChangeType.ChangeCellInternalMetadata) {
				this._assertIndex(e.index);
				const cell = this.cells[e.index];
				cell.internalMetadata = e.internalMetadata;
			}
		});
	}

	private _assertIndex(index: number): void {
		if (index < 0 || index >= this.cells.length) {
			throw new Error(`Illegal index ${index}. Cells length: ${this.cells.length}`);
		}
	}

	_spliceNotebookCells(splices: NotebookCellTextModelSplice<IMainCellDto>[]) {
		splices.reverse().forEach(splice => {
			const cellDtos = splice[2];
			const newCells = cellDtos.map(cell => {
				return new MirrorCell(
					(cell as unknown as IMainCellDto).handle,
					cell.source,
					cell.language,
					cell.cellKind,
					cell.outputs,
					cell.metadata
				);
			});

			this.cells.splice(splice[0], splice[1], ...newCells);
		});
	}
}

class CellSequence implements ISequence {

	constructor(readonly textModel: MirrorNotebookDocument) {
	}

	getElements(): string[] | number[] | Int32Array {
		const hashValue = new Int32Array(this.textModel.cells.length);
		for (let i = 0; i < this.textModel.cells.length; i++) {
			hashValue[i] = this.textModel.cells[i].getComparisonValue();
		}

		return hashValue;
	}

	getCellHash(cell: ICellDto2) {
		const source = Array.isArray(cell.source) ? cell.source.join('\n') : cell.source;
		const hashVal = hash([hash(source), cell.metadata]);
		return hashVal;
	}
}

export class NotebookEditorSimpleWorker implements IRequestHandler, IDisposable {
	_requestHandlerBrand: any;

	private _models: { [uri: string]: MirrorNotebookDocument };

	constructor() {
		this._models = Object.create(null);
	}
	dispose(): void {
	}

	public $acceptNewModel(uri: string, data: NotebookData): void {
		this._models[uri] = new MirrorNotebookDocument(URI.parse(uri), data.cells.map(dto => new MirrorCell(
			(dto as unknown as IMainCellDto).handle,
			dto.source,
			dto.language,
			dto.cellKind,
			dto.outputs,
			dto.metadata
		)), data.metadata);
	}

	public $acceptModelChanged(strURL: string, event: NotebookCellsChangedEventDto) {
		const model = this._models[strURL];
		model?.acceptModelChanged(event);
	}

	public $acceptRemovedModel(strURL: string): void {
		if (!this._models[strURL]) {
			return;
		}
		delete this._models[strURL];
	}

	$computeDiff(originalUrl: string, modifiedUrl: string): INotebookDiffResult {
		const original = this._getModel(originalUrl);
		const modified = this._getModel(modifiedUrl);

		const diff = new LcsDiff(new CellSequence(original), new CellSequence(modified));
		const diffResult = diff.ComputeDiff(false);

		/* let cellLineChanges: { originalCellhandle: number, modifiedCellhandle: number, lineChanges: ILineChange[] }[] = [];

		diffResult.changes.forEach(change => {
			if (change.modifiedLength === 0) {
				// deletion ...
				return;
			}

			if (change.originalLength === 0) {
				// insertion
				return;
			}

			for (let i = 0, len = Math.min(change.modifiedLength, change.originalLength); i < len; i++) {
				let originalIndex = change.originalStart + i;
				let modifiedIndex = change.modifiedStart + i;

				const originalCell = original.cells[originalIndex];
				const modifiedCell = modified.cells[modifiedIndex];

				if (originalCell.getValue() !== modifiedCell.getValue()) {
					// console.log(`original cell ${originalIndex} content change`);
					const originalLines = originalCell.textBuffer.getLinesContent();
					const modifiedLines = modifiedCell.textBuffer.getLinesContent();
					const diffComputer = new DiffComputer(originalLines, modifiedLines, {
						shouldComputeCharChanges: true,
						shouldPostProcessCharChanges: true,
						shouldIgnoreTrimWhitespace: false,
						shouldMakePrettyDiff: true,
						maxComputationTime: 5000
					});

					const lineChanges = diffComputer.computeDiff().changes;

					cellLineChanges.push({
						originalCellhandle: originalCell.handle,
						modifiedCellhandle: modifiedCell.handle,
						lineChanges
					});

					// console.log(lineDecorations);

				} else {
					// console.log(`original cell ${originalIndex} metadata change`);
				}

			}
		});
 */
		return {
			cellsDiff: diffResult,
			// linesDiff: cellLineChanges
		};
	}

	$canPromptRecommendation(modelUrl: string): boolean {
		const model = this._getModel(modelUrl);
		const cells = model.cells;

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			if (cell.cellKind === CellKind.Markup) {
				continue;
			}

			if (cell.language !== 'python') {
				continue;
			}

			const lineCount = cell.textBuffer.getLineCount();
			const maxLineCount = Math.min(lineCount, 20);
			const range = new Range(1, 1, maxLineCount, cell.textBuffer.getLineLength(maxLineCount) + 1);
			const searchParams = new SearchParams('import\\s*pandas|from\\s*pandas', true, false, null);
			const searchData = searchParams.parseSearchRequest();

			if (!searchData) {
				continue;
			}

			const cellMatches = cell.textBuffer.findMatchesLineByLine(range, searchData, true, 1);
			if (cellMatches.length > 0) {
				return true;
			}
		}

		return false;
	}

	protected _getModel(uri: string): MirrorNotebookDocument {
		return this._models[uri];
	}
}

/**
 * Defines the worker entry point. Must be exported and named `create`.
 * @skipMangle
 */
export function create(workerServer: IWorkerServer): IRequestHandler {
	return new NotebookEditorSimpleWorker();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ICurrentPartialCommand } from 'vs/workbench/contrib/terminal/browser/capabilities/commandDetectionCapability';
import { ITerminalCommand } from 'vs/workbench/contrib/terminal/common/terminal';
import { IDecoration, ITerminalAddon, Terminal } from 'xterm';
import * as dom from 'vs/base/browser/dom';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

export class DecorationAddon extends Disposable implements ITerminalAddon {

	protected _terminal: Terminal | undefined;

	constructor(@IClipboardService private readonly _clipboardService: IClipboardService) {
		super();
	}

	activate(terminal: Terminal): void {
		this._terminal = terminal;
	}

	registerOutputDecoration(currentCommand: ICurrentPartialCommand, newCommand: ITerminalCommand): IDecoration {
		const output = newCommand.getOutput();
		if (!currentCommand.commandStartMarker || !this._terminal || !output) {
			throw new Error(`Cannot register output decoration for command: ${currentCommand}, terminal: ${this._terminal}, and output: ${output}`);
		}
		const decoration = this._terminal.registerDecoration({ marker: currentCommand.commandStartMarker, anchor: 'left', x: -2 });
		if (decoration?.element) {
			dom.addDisposableListener(decoration.element, 'click', async () => {
				await this._clipboardService.writeText(output);
			});
			decoration.element.classList.add('terminal-prompt-decoration');
			decoration.element.style.backgroundColor = newCommand.exitCode ? 'red' : 'green';
			return decoration;
		} else {
			throw new Error('Cannot register decoration for a marker that has already been disposed of');
		}
	}
}

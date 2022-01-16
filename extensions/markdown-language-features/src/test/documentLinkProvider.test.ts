/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import LinkProvider from '../features/documentLinkProvider';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { noopToken } from './util';


const testFile = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'x.md');

function getLinksForFile(fileContents: string) {
	const doc = new InMemoryDocument(testFile, fileContents);
	const provider = new LinkProvider(createNewMarkdownEngine());
	return provider.provideDocumentLinks(doc, noopToken);
}

function assertRangeEqual(expected: vscode.Range, actual: vscode.Range) {
	assert.strictEqual(expected.start.line, actual.start.line);
	assert.strictEqual(expected.start.character, actual.start.character);
	assert.strictEqual(expected.end.line, actual.end.line);
	assert.strictEqual(expected.end.character, actual.end.character);
}

suite('markdown.DocumentLinkProvider', () => {
	test('Should not return anything for empty document', async () => {
		const links = await getLinksForFile('');
		assert.strictEqual(links.length, 0);
	});

	test('Should not return anything for simple document without links', async () => {
		const links = await getLinksForFile('# a\nfdasfdfsafsa');
		assert.strictEqual(links.length, 0);
	});

	test('Should detect basic http links', async () => {
		const links = await getLinksForFile('a [b](https://example.com) c');
		assert.strictEqual(links.length, 1);
		const [link] = links;
		assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 25));
	});

	test('Should detect basic workspace links', async () => {
		{
			const links = await getLinksForFile('a [b](./file) c');
			assert.strictEqual(links.length, 1);
			const [link] = links;
			assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 12));
		}
		{
			const links = await getLinksForFile('a [b](file.png) c');
			assert.strictEqual(links.length, 1);
			const [link] = links;
			assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 14));
		}
	});

	test('Should detect links with title', async () => {
		const links = await getLinksForFile('a [b](https://example.com "abc") c');
		assert.strictEqual(links.length, 1);
		const [link] = links;
		assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 25));
	});

	// #35245
	test('Should handle links with escaped characters in name', async () => {
		const links = await getLinksForFile('a [b\\]](./file)');
		assert.strictEqual(links.length, 1);
		const [link] = links;
		assertRangeEqual(link.range, new vscode.Range(0, 8, 0, 14));
	});


	test('Should handle links with balanced parens', async () => {
		{
			const links = await getLinksForFile('a [b](https://example.com/a()c) c');
			assert.strictEqual(links.length, 1);
			const [link] = links;
			assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 30));
		}
		{
			const links = await getLinksForFile('a [b](https://example.com/a(b)c) c');
			assert.strictEqual(links.length, 1);
			const [link] = links;
			assertRangeEqual(link.range, new vscode.Range(0, 6, 0, 31));

		}
		{
			// #49011
			const links = await getLinksForFile('[A link](http://ThisUrlhasParens/A_link(in_parens))');
			assert.strictEqual(links.length, 1);
			const [link] = links;
			assertRangeEqual(link.range, new vscode.Range(0, 9, 0, 50));
		}
	});

	test('Should handle two links without space', async () => {
		const links = await getLinksForFile('a ([test](test)[test2](test2)) c');
		assert.strictEqual(links.length, 2);
		const [link1, link2] = links;
		assertRangeEqual(link1.range, new vscode.Range(0, 10, 0, 14));
		assertRangeEqual(link2.range, new vscode.Range(0, 23, 0, 28));
	});

	// #49238
	test('should handle hyperlinked images', async () => {
		{
			const links = await getLinksForFile('[![alt text](image.jpg)](https://example.com)');
			assert.strictEqual(links.length, 2);
			const [link1, link2] = links;
			assertRangeEqual(link1.range, new vscode.Range(0, 13, 0, 22));
			assertRangeEqual(link2.range, new vscode.Range(0, 25, 0, 44));
		}
		{
			const links = await getLinksForFile('[![a]( whitespace.jpg )]( https://whitespace.com )');
			assert.strictEqual(links.length, 2);
			const [link1, link2] = links;
			assertRangeEqual(link1.range, new vscode.Range(0, 7, 0, 21));
			assertRangeEqual(link2.range, new vscode.Range(0, 26, 0, 48));
		}
		{
			const links = await getLinksForFile('[![a](img1.jpg)](file1.txt) text [![a](img2.jpg)](file2.txt)');
			assert.strictEqual(links.length, 4);
			const [link1, link2, link3, link4] = links;
			assertRangeEqual(link1.range, new vscode.Range(0, 6, 0, 14));
			assertRangeEqual(link2.range, new vscode.Range(0, 17, 0, 26));
			assertRangeEqual(link3.range, new vscode.Range(0, 39, 0, 47));
			assertRangeEqual(link4.range, new vscode.Range(0, 50, 0, 59));
		}
	});

	test('Should not consider link references starting with ^ character valid (#107471)', async () => {
		const links = await getLinksForFile('[^reference]: https://example.com');
		assert.strictEqual(links.length, 0);
	});

	test('Should find definitions links with spaces in angle brackets (#136073)', async () => {
		const links = await getLinksForFile([
			'[a]: <b c>',
			'[b]: <cd>',
		].join('\n'));
		assert.strictEqual(links.length, 2);

		const [link1, link2] = links;
		assertRangeEqual(link1.range, new vscode.Range(0, 6, 0, 9));
		assertRangeEqual(link2.range, new vscode.Range(1, 6, 1, 8));
	});

	test('Should not consider links in fenced, indented and inline code', async () => {
		const links = await getLinksForFile(['```',
			'[ignore](https://1.com)',
			'```',
			'~~~',
			'[ignore](https://2.com)',
			'~~~',
			'    [ignore](https://3.com)',
			'`` ',
			'[ignore](https://4.com) ',
			'``',
			'`` ',
			'',
			'[link](https://5.com)',
			'',
			'``',
			'`[ignore](https://6.com)`',
			'[link](https://7.com) `[b](https://8.com)',
			'` [link](https://9.com)',
			'`',
			'[ignore](https://10.com)`'].join('\n'));
		assert.deepStrictEqual(links.map(l => l.target?.authority), ['5.com', '7.com', '9.com']);
	});
});



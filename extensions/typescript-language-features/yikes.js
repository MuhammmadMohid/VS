/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
const path = require('path');
const fs = require('fs');
const o = {
	from: '../node_modules/typescript/lib/tsserver.js',
	to: 'dist/browser/typescript/tsserver.web.js',
	transform() {
		const dynamicImportCompatPath = path.join(__dirname, '..', 'node_modules', 'typescript', 'lib', 'dynamicImportCompat.js');
		const tsserver = fs.readFileSync(path.join(__dirname, 'node_modules', 'typescript', 'lib', 'tsserver.js'));
		const prefix = fs.existsSync(dynamicImportCompatPath) ? fs.readFileSync(dynamicImportCompatPath) : undefined;
		// TODO: All this extra work can *probably* be done with webpack tools in some way.
		const filenames = {
			'vscode-uri': path.join(__dirname, 'node_modules', 'vscode-uri', 'lib', 'umd', 'index.js'),
			'./vscode': path.join(__dirname, 'node_modules', '@vscode/sync-api-client', 'lib', 'vscode.js'),
			'./apiClient': path.join(__dirname, 'node_modules', '@vscode/sync-api-client', 'lib', 'apiClient.js'),
			'@vscode/sync-api-client': path.join(__dirname, 'node_modules', '@vscode/sync-api-client', 'lib', 'main.js'),
			'./ral': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'ral.js'),
			'common--./connection': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'connection.js'), // referenced from common/api.js and /protocol.js
			'./protocol': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'protocol.js'),
			'browser--./connection': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'browser', 'connection.js'), // referenced from connection.js, main.js, ril.js
			'./ril': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'browser', 'ril.js'),
			'./messageCancellation': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'messageCancellation.js'),
			'common--./messageConnection': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'messageConnection.js'),
			'browser--./messageConnection': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'browser', 'messageConnection.js'),
			'../common/api': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'common', 'api.js'),
			'@vscode/sync-api-common': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'lib', 'browser', 'main.js'),
			'@vscode/sync-api-common/browser': path.join(__dirname, 'node_modules', '@vscode/sync-api-common', 'browser.js'),
			'vscode-wasm-typescript': path.join(__dirname, 'node_modules', 'vscode-wasm-typescript', 'dist', 'index.js'),
		};
		const redirect = {
			'./lib/browser/main': '@vscode/sync-api-common',
			'./lib/common/ral': './ral',
			'../common/ral': './ral',
			'../common/connection': 'common--./connection',
			'../common/messageConnection': 'common--./messageConnection',
		};
		const connectionReplacements = {
			'@vscode/sync-api-common': [['require("./connection")', 'require("browser--./connection")'],
										['require("./messageConnection")', 'require("browser--./messageConnection")']],
			'./ril': [['require("./connection")', 'require("browser--./connection")']],
			'common--./connection': [['require("./connection")', 'require("browser--./connection")']],
			'../common/api': [['require("./connection")', 'require("common--./connection")'],
										['require("./messageConnection")', 'require("common--./messageConnection")']],
			'./protocol': [['require("./connection")', 'require("common--./connection")']],
		};
		/** @type {Record<string, string>} */
		const modules = {};
		for (const name in filenames) {
			modules[name] = fs.readFileSync(filenames[name], 'utf8');
			if (name in connectionReplacements) {
				for (const [fro,to] of connectionReplacements[name]) {
					modules[name] = modules[name].replace(fro, to);
				}
			}
		}
		return prefix + '\n' + tsserver + '\n' + wrapper(modules, redirect);
	}
};
console.log(`\nwriting combined code to ${o.to}\n`);
fs.writeFileSync(o.to, o.transform());

/**
 * @param {Record<string, string>} modules
 * @param {Record<string, string>} redirect
 */
function wrapper(modules, redirect) {
	let prog = `
const experts = {
	${Object.keys(modules).map(n => `"${n}": {}`).join(',\n	')}
};
${Object.keys(redirect).map(n => `experts["${n}"] = experts["${redirect[n]}"];`).join('\n')}
experts["typescript/lib/tsserverlibrary"] = ts;
function requiem(name) {
	if (!(name in experts)) {
		console.log('require missing', name);
		throw new Error('require missing ' + name);
	}
	return experts[name];
}
`;
	for (const name in modules) {
		prog += `
//////////////////////////// ${name} //////////////////////////////////
experts["${name}"] = (function (exports, require, module) {
${modules[name]}
return module.exports;
})(experts["${name}"], requiem, { exports: experts["${name}"] });


`;
	}
	// NOTE: As long as it's OK to have vscode-wasm-typescript run event listener stuff inside
	// If I end up needing async, then the last function will need to be `async function` and the call
	// might need a `.then` postfix, although the one I know is for node
	return prog;
}

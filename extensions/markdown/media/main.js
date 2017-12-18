/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

(function () {
	// From https://remysharp.com/2010/07/21/throttling-function-calls
	function throttle(fn, threshhold, scope) {
		threshhold || (threshhold = 250);
		var last, deferTimer;
		return function () {
			var context = scope || this;

			var now = +new Date,
				args = arguments;
			if (last && now < last + threshhold) {
				// hold on to it
				clearTimeout(deferTimer);
				deferTimer = setTimeout(function () {
					last = now;
					fn.apply(context, args);
				}, threshhold + last - now);
			} else {
				last = now;
				fn.apply(context, args);
			}
		};
	}

	function postMessage(command, args) {
		window.parent.postMessage({
			command: 'did-click-link',
			data: `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
		}, 'file://');
	}

	/**
	 * Find the html elements that map to a specific target line in the editor.
	 *
	 * If an exact match, returns a single element. If the line is between elements,
	 * returns the element prior to and the element after the given line.
	 */
	function getElementsForSourceLine(targetLine) {
		const lines = document.getElementsByClassName('code-line');
		let previous = lines[0] && +lines[0].getAttribute('data-line') ? { line: +lines[0].getAttribute('data-line'), element: lines[0] } : null;
		for (const element of lines) {
			const lineNumber = +element.getAttribute('data-line');
			if (isNaN(lineNumber)) {
				continue;
			}
			const entry = { line: lineNumber, element: element };
			if (lineNumber === targetLine) {
				return { previous: entry, next: null };
			} else if (lineNumber > targetLine) {
				return { previous, next: entry };
			}
			previous = entry;
		}
		return { previous };
	}

	/**
	 * Find the html elements that are at a specific pixel offset on the page.
	 *
	 * @returns {{ previous: { element: any, line: number }, next?: { element: any, line: number } }}
	 */
	function getLineElementsAtPageOffset(offset) {
		const allLines = document.getElementsByClassName('code-line');
		/** @type {Element[]} */
		const lines = Array.prototype.filter.call(allLines, element => {
			const line = +element.getAttribute('data-line');
			return !isNaN(line)
		});

		const position = offset - window.scrollY;

		let lo = -1;
		let hi = lines.length - 1;
		while (lo + 1 < hi) {
			const mid = Math.floor((lo + hi) / 2);
			const bounds = lines[mid].getBoundingClientRect();
			if (bounds.top + bounds.height >= position) {
				hi = mid;
			} else {
				lo = mid;
			}
		}

		const hiElement = lines[hi];
		const hiLine = +hiElement.getAttribute('data-line');
		if (hi >= 1 && hiElement.getBoundingClientRect().top > position) {
			const loElement = lines[lo];
			const loLine = +loElement.getAttribute('data-line');
			const bounds = loElement.getBoundingClientRect();
			const previous = { element: loElement, line: loLine + (position - bounds.top) / (bounds.height) };
			const next = { element: hiElement, line: hiLine, fractional: 0 };
			return { previous, next };
		}

		const bounds = hiElement.getBoundingClientRect();
		const previous = { element: hiElement, line: hiLine + (position - bounds.top) / (bounds.height) };
		return { previous };
	}

	function getSourceRevealAddedOffset() {
		return -(window.innerHeight * 1 / 5);
	}

	/**
	 * Attempt to reveal the element for a source line in the editor.
	 */
	function scrollToRevealSourceLine(line) {
		const { previous, next } = getElementsForSourceLine(line);
		marker.update(previous && previous.element);
		if (previous && settings.scrollPreviewWithEditorSelection) {
			let scrollTo = 0;
			if (next) {
				// Between two elements. Go to percentage offset between them.
				const betweenProgress = (line - previous.line) / (next.line - previous.line);
				const elementOffset = next.element.getBoundingClientRect().top - previous.element.getBoundingClientRect().top;
				scrollTo = previous.element.getBoundingClientRect().top + betweenProgress * elementOffset;
			} else {
				scrollTo = previous.element.getBoundingClientRect().top;
			}
			window.scroll(0, window.scrollY + scrollTo + getSourceRevealAddedOffset());
		}
	}

	function getEditorLineNumberForPageOffset(offset) {
		const { previous, next } = getLineElementsAtPageOffset(offset);
		if (previous) {
			if (next) {
				const betweenProgress = (offset - window.scrollY - previous.element.getBoundingClientRect().top) / (next.element.getBoundingClientRect().top - previous.element.getBoundingClientRect().top);
				return previous.line + betweenProgress * (next.line - previous.line);
			} else {
				return previous.line;
			}
		}
		return null;
	}


	class ActiveLineMarker {
		update(before) {
			this._unmarkActiveElement(this._current);
			this._markActiveElement(before);
			this._current = before;
		}

		_unmarkActiveElement(element) {
			if (!element) {
				return;
			}
			element.className = element.className.replace(/\bcode-active-line\b/g);
		}

		_markActiveElement(element) {
			if (!element) {
				return;
			}
			element.className += ' code-active-line';
		}
	}

	var scrollDisabled = true;
	var marker = new ActiveLineMarker();
	const settings = JSON.parse(document.getElementById('vscode-markdown-preview-data').getAttribute('data-settings'));

	function onLoad() {
		if (settings.scrollPreviewWithEditorSelection) {
			const initialLine = +settings.line;
			if (!isNaN(initialLine)) {
				setTimeout(() => {
					scrollDisabled = true;
					scrollToRevealSourceLine(initialLine);
				}, 0);
			}
		}
	}

	if (document.readyState === 'loading' || document.readyState === 'uninitialized') {
		document.addEventListener('DOMContentLoaded', onLoad);
	} else {
		onLoad();
	}


	window.addEventListener('resize', () => {
		scrollDisabled = true;
	}, true);

	window.addEventListener('message', (() => {
		const doScroll = throttle(line => {
			scrollDisabled = true;
			scrollToRevealSourceLine(line);
		}, 50);
		return event => {
			const line = +event.data.line;
			if (!isNaN(line)) {
				doScroll(line);
			}
		};
	})(), false);

	document.addEventListener('dblclick', event => {
		if (!settings.doubleClickToSwitchToEditor) {
			return;
		}

		// Ignore clicks on links
		for (let node = event.target; node; node = node.parentNode) {
			if (node.tagName === "A") {
				return;
			}
		}

		const offset = event.pageY;
		const line = getEditorLineNumberForPageOffset(offset);
		if (!isNaN(line)) {
			postMessage('_markdown.didClick', [settings.source, line]);
		}
	});

	document.addEventListener('click', event => {
		if (!event) {
			return;
		}

		const baseElement = document.getElementsByTagName('base')[0];

		/** @type {any} */
		let node = event.target;
		while (node) {
			if (node.tagName && node.tagName.toLowerCase() === 'a' && node.href) {
				if (node.href.startsWith('file://')) {
					const [path, fragment] = node.href.replace(/^file:\/\//i, '').split('#');
					postMessage('_markdown.openDocumentLink', { path, fragment });
					event.preventDefault();
					event.stopPropagation();
					break;
				}
				break;
			}
			node = node.parentNode;
		}
	}, true);

	if (settings.scrollEditorWithPreview) {
		window.addEventListener('scroll', throttle(() => {
			if (scrollDisabled) {
				scrollDisabled = false;
			} else {
				const line = getEditorLineNumberForPageOffset(window.scrollY);
				if (!isNaN(line)) {
					postMessage('_markdown.revealLine', [settings.source, line]);
				}
			}
		}, 50));
	}
}());
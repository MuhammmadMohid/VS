/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2 } from '../../../../platform/actions/common/actions';
import { MergeEditorOpenContentsFromJSON, OpenSelectionInTemporaryMergeEditor } from './devCommands';

// Dev Commands
registerAction2(MergeEditorOpenContentsFromJSON);
registerAction2(OpenSelectionInTemporaryMergeEditor);

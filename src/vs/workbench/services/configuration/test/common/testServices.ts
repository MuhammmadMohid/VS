/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri';
import { IJSONEditingService, IJSONValue } from '../../common/jsonEditing';

export class TestJSONEditingService implements IJSONEditingService {
	_serviceBrand: any;

	async write(resource: URI, values: IJSONValue[], save: boolean): Promise<void> { }
}

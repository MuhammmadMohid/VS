/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/newIssueReporter';
import { IMenuService } from '../../../../platform/actions/common/actions';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation';
import { ILogService } from '../../../../platform/log/common/log';
import { INativeHostService } from '../../../../platform/native/common/native';
import product from '../../../../platform/product/common/product';
import { IssueFormService } from '../browser/issueFormService';
import { IIssueFormService, IssueReporterData } from '../common/issue';
import { IssueReporter2 } from './issueReporterService2';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService';
import { IHostService } from '../../../services/host/browser/host';

export class NativeIssueFormService extends IssueFormService implements IIssueFormService {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IAuxiliaryWindowService auxiliaryWindowService: IAuxiliaryWindowService,
		@ILogService logService: ILogService,
		@IDialogService dialogService: IDialogService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,) {
		super(instantiationService, auxiliaryWindowService, menuService, contextKeyService, logService, dialogService, hostService);
	}

	// override to grab platform info
	override async openReporter(data: IssueReporterData): Promise<void> {
		if (this.hasToReload(data)) {
			return;
		}

		const bounds = await this.nativeHostService.getActiveWindowPosition();
		if (!bounds) {
			return;
		}

		await this.openAuxIssueReporter(data, bounds);

		// Get platform information
		const { arch, release, type } = await this.nativeHostService.getOSProperties();
		this.arch = arch;
		this.release = release;
		this.type = type;

		// create issue reporter and instantiate
		if (this.issueReporterWindow) {
			const issueReporter = this.instantiationService.createInstance(IssueReporter2, !!this.environmentService.disableExtensions, data, { type: this.type, arch: this.arch, release: this.release }, product, this.issueReporterWindow);
			issueReporter.render();
		}
	}
}

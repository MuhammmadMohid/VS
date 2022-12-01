/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Promises } from 'vs/base/common/async';
import { getErrorMessage } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { isWindows } from 'vs/base/common/platform';
import { joinPath } from 'vs/base/common/resources';
import * as semver from 'vs/base/common/semver/semver';
import { isBoolean } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { Promises as FSPromises } from 'vs/base/node/pfs';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { ExtensionManagementError, ExtensionManagementErrorCode, IExtensionGalleryService, IGalleryExtension, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionKey, groupByExtension } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ExtensionSignatureVerificationError, IExtensionSignatureVerificationService } from 'vs/platform/extensionManagement/node/extensionSignatureVerificationService';
import { TargetPlatform } from 'vs/platform/extensions/common/extensions';
import { IFileService, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';

export class ExtensionsDownloader extends Disposable {

	private static readonly SignatureArchiveExtension = '.sigzip';

	readonly extensionsDownloadDir: URI;
	private readonly cache: number;
	private readonly cleanUpPromise: Promise<void>;

	constructor(
		private readonly targetPlatform: Promise<TargetPlatform>,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IExtensionSignatureVerificationService private readonly extensionSignatureVerificationService: IExtensionSignatureVerificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.extensionsDownloadDir = environmentService.extensionsDownloadLocation;
		this.cache = 20; // Cache 20 downloaded VSIX files
		this.cleanUpPromise = this.cleanUp();
	}

	async download(extension: IGalleryExtension, operation: InstallOperation): Promise<{ readonly location: URI; verified: boolean }> {
		await this.cleanUpPromise;

		const location = joinPath(this.extensionsDownloadDir, this.getName(extension));
		try {
			await this.downloadFile(extension, location, location => this.extensionGalleryService.download(extension, location, operation));
		} catch (error) {
			throw new ExtensionManagementError(error.message, ExtensionManagementErrorCode.Download);
		}

		let verified: boolean = false;
		if (await this.checkForVerification(extension)) {
			const signatureArchiveLocation = await this.downloadSignatureArchive(extension);
			try {
				verified = await this.extensionSignatureVerificationService.verify(location.fsPath, signatureArchiveLocation.fsPath);
				this.logService.info(`Verified extension: ${extension.identifier.id}`, verified);
			} catch (error) {
				await this.delete(signatureArchiveLocation);
				await this.delete(location);
				throw new ExtensionManagementError((error as ExtensionSignatureVerificationError).code, ExtensionManagementErrorCode.Signature);
			}
		}

		return { location, verified };
	}

	private async checkForVerification(extension: IGalleryExtension): Promise<boolean> {
		if (!extension.isSigned) {
			return false;
		}
		const targetPlatform = await this.targetPlatform;
		// Signing module has issue in this platform - https://github.com/microsoft/vscode/issues/164726
		if (targetPlatform === TargetPlatform.LINUX_ARMHF) {
			return false;
		}
		const value = this.configurationService.getValue('extensions.verifySignature');
		if (isBoolean(value)) {
			return value;
		}
		return this.productService.quality !== 'stable';
	}

	private async downloadSignatureArchive(extension: IGalleryExtension): Promise<URI> {
		await this.cleanUpPromise;

		const location = joinPath(this.extensionsDownloadDir, `${this.getName(extension)}${ExtensionsDownloader.SignatureArchiveExtension}`);
		await this.downloadFile(extension, location, location => this.extensionGalleryService.downloadSignatureArchive(extension, location));
		return location;
	}

	private async downloadFile(extension: IGalleryExtension, location: URI, downloadFn: (location: URI) => Promise<void>): Promise<void> {
		// Do not download if exists
		if (await this.fileService.exists(location)) {
			return;
		}

		// Download directly if locaiton is not file scheme
		if (location.scheme !== Schemas.file) {
			await downloadFn(location);
			return;
		}

		// Download to temporary location first only if file does not exist
		const tempLocation = joinPath(this.extensionsDownloadDir, `.${generateUuid()}`);
		if (!await this.fileService.exists(tempLocation)) {
			await downloadFn(tempLocation);
		}

		try {
			// Rename temp location to original
			await this.rename(tempLocation, location, Date.now() + (2 * 60 * 1000) /* Retry for 2 minutes */);
		} catch (error) {
			try {
				await this.fileService.del(tempLocation);
			} catch (e) { /* ignore */ }
			if (error.code === 'ENOTEMPTY') {
				this.logService.info(`Rename failed because the file was downloaded by another source. So ignoring renaming.`, extension.identifier.id, location.path);
			} else {
				this.logService.info(`Rename failed because of ${getErrorMessage(error)}. Deleted the file from downloaded location`, tempLocation.path);
				throw error;
			}
		}
	}

	async delete(location: URI): Promise<void> {
		await this.cleanUpPromise;
		await this.fileService.del(location);
	}

	private async rename(from: URI, to: URI, retryUntil: number): Promise<void> {
		try {
			await FSPromises.rename(from.fsPath, to.fsPath);
		} catch (error) {
			if (isWindows && error && error.code === 'EPERM' && Date.now() < retryUntil) {
				this.logService.info(`Failed renaming ${from} to ${to} with 'EPERM' error. Trying again...`);
				return this.rename(from, to, retryUntil);
			}
			throw error;
		}
	}

	private async cleanUp(): Promise<void> {
		try {
			if (!(await this.fileService.exists(this.extensionsDownloadDir))) {
				this.logService.trace('Extension VSIX downloads cache dir does not exist');
				return;
			}
			const folderStat = await this.fileService.resolve(this.extensionsDownloadDir, { resolveMetadata: true });
			if (folderStat.children) {
				const toDelete: URI[] = [];
				const vsixs: [ExtensionKey, IFileStatWithMetadata][] = [];
				const signatureArchives: URI[] = [];

				for (const stat of folderStat.children) {
					if (stat.name.endsWith(ExtensionsDownloader.SignatureArchiveExtension)) {
						signatureArchives.push(stat.resource);
					} else {
						const extension = ExtensionKey.parse(stat.name);
						if (extension) {
							vsixs.push([extension, stat]);
						}
					}
				}

				const byExtension = groupByExtension(vsixs, ([extension]) => extension);
				const distinct: IFileStatWithMetadata[] = [];
				for (const p of byExtension) {
					p.sort((a, b) => semver.rcompare(a[0].version, b[0].version));
					toDelete.push(...p.slice(1).map(e => e[1].resource)); // Delete outdated extensions
					distinct.push(p[0][1]);
				}
				distinct.sort((a, b) => a.mtime - b.mtime); // sort by modified time
				toDelete.push(...distinct.slice(0, Math.max(0, distinct.length - this.cache)).map(s => s.resource)); // Retain minimum cacheSize and delete the rest
				toDelete.push(...signatureArchives); // Delete all signature archives

				await Promises.settled(toDelete.map(resource => {
					this.logService.trace('Deleting from cache', resource.path);
					return this.fileService.del(resource);
				}));
			}
		} catch (e) {
			this.logService.error(e);
		}
	}

	private getName(extension: IGalleryExtension): string {
		return this.cache ? ExtensionKey.create(extension).toString().toLowerCase() : generateUuid();
	}

}

import {Dialog, fetchPost, Plugin, Setting, showMessage} from "siyuan";
import type {IMenu, IProtyle} from "siyuan";
import "./index.scss";

const STORAGE_NAME = "settings";
const CUSTOM_SY_AV_VIEW = "custom-sy-av-view";
const DEFAULT_ASSET_FIELD_NAME = "内容图";
const IMAGE_EXTENSIONS = [
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".webp",
];
const CONTENT_IMAGE_INSERT_ICON = `<svg class="b3-menu__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="7" cy="5" rx="4" ry="2"/><path d="M3 5v5c0 1.1 1.8 2 4 2s4-.9 4-2V5"/><path d="M3 7.5c0 1.1 1.8 2 4 2s4-.9 4-2"/><path d="M11.5 8.2c2.4.3 4.3 1.7 5.4 3.8"/><path d="m14.6 11.8 2.7.8.8-2.7"/><rect x="11" y="13" width="9" height="6.5" rx="1.4"/><path d="m12.5 17.6 1.8-1.7 1.4 1.2 1.2-1 1.6 1.5"/><circle cx="17.7" cy="15" r=".6" fill="currentColor" stroke="none"/></svg>`;
const CONTENT_IMAGE_SYNC_ICON = `<svg class="b3-menu__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12.5" width="9" height="6.5" rx="1.4"/><path d="m4.5 17.1 1.8-1.7 1.4 1.2 1.2-1 1.6 1.5"/><circle cx="9.7" cy="14.5" r=".6" fill="currentColor" stroke="none"/><ellipse cx="16" cy="5" rx="4" ry="2"/><path d="M12 5v5c0 1.1 1.8 2 4 2s4-.9 4-2V5"/><path d="M12 7.5c0 1.1 1.8 2 4 2s4-.9 4-2"/><path d="M8.4 11.1c1.7-2.2 3.8-3.4 6.4-3.7"/><path d="m12.7 4.9 2.7 2.3-2.5 2.4"/></svg>`;

interface PluginSettings {
    assetFieldName: string;
    replaceExisting: boolean;
    autoSyncVisible: boolean;
}

interface SiyuanResponse<T> {
    code: number;
    msg?: string;
    data: T;
}

interface AVRenderData {
    id: string;
    name: string;
    viewID: string;
    viewType: string;
    view: AVView;
}

interface AVView {
    columns?: AVColumn[];
    fields?: AVColumn[];
    rows?: AVRow[];
    cards?: AVCard[];
    groups?: AVView[];
}

interface AVColumn {
    id: string;
    name: string;
    type: string;
}

interface AVRow {
    id: string;
    cells: AVCell[];
}

interface AVCard {
    id: string;
    values: AVCell[];
}

interface AVCell {
    id: string;
    valueType: string;
    value?: AVCellValue;
}

interface AVCellValue {
    id?: string;
    keyID?: string;
    blockID?: string;
    type: string;
    isDetached?: boolean;
    block?: {
        id?: string;
        content?: string;
    };
    mAsset?: AVAsset[];
}

interface AVAsset {
    type: "image";
    name: string;
    content: string;
}

interface SyncRecord {
    itemID: string;
    cells: AVCell[];
}

interface AssetRow {
    root_id?: string;
    block_id?: string;
    path?: string;
    name?: string;
    title?: string;
}

interface BatchValue {
    keyID: string;
    itemID: string;
    value: AVCellValue;
}

interface AVKeyValues {
    key: AVColumn;
    values?: AVCellValue[];
}

interface BlockAttributeViewKeys {
    avID: string;
    avName: string;
    blockIDs: string[];
    keyValues: AVKeyValues[];
}

interface BlockMarkdownRow {
    id: string;
    parent_id?: string;
    sort?: number;
    markdown?: string;
}

interface InsertBlockOperation {
    id?: string;
}

interface InsertBlockTransaction {
    doOperations?: InsertBlockOperation[];
}

interface ContentImageSource {
    id: string;
    avID: string;
    avName: string;
    fieldID: string;
    fieldName: string;
    itemID: string;
    assets: AVAsset[];
}

interface AVMenuDetail {
    menu?: {
        addItem(item: IMenu): void;
    };
    element?: Element;
    selectRowElements?: Iterable<Element> | ArrayLike<Element>;
}

interface ImageMenuDetail {
    menu?: {
        addItem(item: IMenu): void;
    };
    protyle?: IProtyle;
    element?: HTMLElement;
}

interface ContentMenuDetail extends ImageMenuDetail {
    range?: Range;
}

const defaultSettings: PluginSettings = {
    assetFieldName: DEFAULT_ASSET_FIELD_NAME,
    replaceExisting: true,
    autoSyncVisible: false,
};

export default class DbContentImagesPlugin extends Plugin {
    private settingsData: PluginSettings = {...defaultSettings};
    private fieldNameInput?: HTMLInputElement;
    private replaceExistingInput?: HTMLInputElement;
    private autoSyncInput?: HTMLInputElement;
    private autoSyncTimer = 0;
    private syncingAvIDs = new Set<string>();
    private wsHandler = (event: CustomEvent) => this.handleWsEvent(event);
    private avMenuHandler = (event: CustomEvent) => this.addAVMenuItem(event);
    private imageMenuHandler = (event: CustomEvent) => this.addImageMenuItem(event);
    private contentMenuHandler = (event: CustomEvent) => this.addContentMenuItem(event);

    async onload() {
        await this.loadSettings();
        this.eventBus.on("ws-main", this.wsHandler);
        this.eventBus.on("open-menu-av", this.avMenuHandler);
        this.eventBus.on("open-menu-image", this.imageMenuHandler);
        this.eventBus.on("open-menu-content", this.contentMenuHandler);

        this.addCommand({
            langKey: "syncCurrentDatabase",
            callback: () => {
                this.syncCurrentDatabase().catch((error) => this.showError(error));
            },
        });

        this.addCommand({
            langKey: "syncVisibleDatabases",
            callback: () => {
                this.syncVisibleDatabases().catch((error) => this.showError(error));
            },
        });

        this.setting = new Setting({
            confirmCallback: () => {
                this.saveSettingsFromInputs().catch((error) => this.showError(error));
            },
        });

        this.setting.addItem({
            title: this.i18n.assetFieldName,
            description: this.i18n.assetFieldNameDesc,
            createActionElement: () => {
                this.fieldNameInput = document.createElement("input");
                this.fieldNameInput.className = "b3-text-field fn__block";
                this.fieldNameInput.value = this.settingsData.assetFieldName;
                this.fieldNameInput.placeholder = DEFAULT_ASSET_FIELD_NAME;
                return this.fieldNameInput;
            },
        });

        this.setting.addItem({
            title: this.i18n.replaceExisting,
            description: this.i18n.replaceExistingDesc,
            createActionElement: () => {
                this.replaceExistingInput = this.createSwitch(this.settingsData.replaceExisting);
                return this.replaceExistingInput;
            },
        });

        this.setting.addItem({
            title: this.i18n.autoSyncVisible,
            description: this.i18n.autoSyncVisibleDesc,
            createActionElement: () => {
                this.autoSyncInput = this.createSwitch(this.settingsData.autoSyncVisible);
                return this.autoSyncInput;
            },
        });
    }

    onunload() {
        this.eventBus.off("ws-main", this.wsHandler);
        this.eventBus.off("open-menu-av", this.avMenuHandler);
        this.eventBus.off("open-menu-image", this.imageMenuHandler);
        this.eventBus.off("open-menu-content", this.contentMenuHandler);
        window.clearTimeout(this.autoSyncTimer);
    }

    private async loadSettings() {
        this.data[STORAGE_NAME] = {...defaultSettings};
        try {
            await this.loadData(STORAGE_NAME);
        } catch (error) {
            console.debug(`[${this.name}] load settings failed`, error);
        }
        this.settingsData = this.normalizeSettings(this.data[STORAGE_NAME]);
    }

    private async saveSettingsFromInputs() {
        this.settingsData = {
            assetFieldName: (this.fieldNameInput?.value || DEFAULT_ASSET_FIELD_NAME).trim() || DEFAULT_ASSET_FIELD_NAME,
            replaceExisting: !!this.replaceExistingInput?.checked,
            autoSyncVisible: !!this.autoSyncInput?.checked,
        };
        await this.saveData(STORAGE_NAME, this.settingsData);
        showMessage(this.i18n.settingsSaved);
    }

    private normalizeSettings(raw: unknown): PluginSettings {
        const data = raw as Partial<PluginSettings> | undefined;
        return {
            assetFieldName: (data?.assetFieldName || DEFAULT_ASSET_FIELD_NAME).trim() || DEFAULT_ASSET_FIELD_NAME,
            replaceExisting: typeof data?.replaceExisting === "boolean" ? data.replaceExisting : defaultSettings.replaceExisting,
            autoSyncVisible: typeof data?.autoSyncVisible === "boolean" ? data.autoSyncVisible : defaultSettings.autoSyncVisible,
        };
    }

    private createSwitch(checked: boolean) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch fn__flex-center";
        input.checked = checked;
        return input;
    }

    private async syncCurrentDatabase() {
        const avElement = this.findCurrentAVElement();
        if (!avElement) {
            showMessage(this.i18n.noCurrentDatabase);
            return;
        }
        const result = await this.syncAVElement(avElement);
        this.showSyncResult(result);
    }

    private async syncVisibleDatabases() {
        const elements = this.findVisibleAVElements();
        if (elements.length === 0) {
            showMessage(this.i18n.noVisibleDatabase);
            return;
        }

        let changed = 0;
        let scanned = 0;
        for (const element of elements) {
            const result = await this.syncAVElement(element);
            changed += result.changed;
            scanned += result.scanned;
        }
        showMessage(this.i18n.syncSummary.replace("${changed}", `${changed}`).replace("${scanned}", `${scanned}`));
    }

    private async syncSelectedDatabaseItems(element: HTMLElement, itemIDs: string[]) {
        if (itemIDs.length === 0) {
            const result = await this.syncAVElement(element);
            this.showSyncResult(result);
            return;
        }

        const result = await this.syncAVElement(element, itemIDs);
        this.showSyncResult(result);
    }

    private async syncAVElement(element: HTMLElement, onlyItemIDs?: string[]) {
        const avID = element.getAttribute("data-av-id") || "";
        if (!avID) {
            return {changed: 0, scanned: 0};
        }
        if (this.syncingAvIDs.has(avID)) {
            return {changed: 0, scanned: 0};
        }

        this.syncingAvIDs.add(avID);
        try {
            const result = await this.renderAttributeView(element);
            const fields = this.getFields(result.view);
            const assetField = this.findAssetField(fields);
            if (!assetField) {
                throw new Error(this.i18n.noAssetField.replace("${field}", this.settingsData.assetFieldName));
            }

            const onlyItems = new Set(onlyItemIDs || []);
            let records = this.collectRecords(result.view);
            if (onlyItems.size > 0) {
                records = records.filter((record) => onlyItems.has(record.itemID));
            }
            const fieldIndex = fields.findIndex((field) => field.id === assetField.id);
            const rows = this.collectBoundRows(records, fieldIndex, assetField.id);
            const imageMap = await this.collectImages(rows.map((row) => row.boundBlockID));
            const updates: BatchValue[] = [];

            for (const row of rows) {
                const images = imageMap.get(row.boundBlockID) || [];
                const current = row.assetCell.value?.mAsset || [];
                if (!this.settingsData.replaceExisting && current.length > 0) {
                    continue;
                }
                if (this.sameAssets(current, images)) {
                    continue;
                }
                updates.push({
                    keyID: assetField.id,
                    itemID: row.record.itemID,
                    value: {
                        id: row.assetCell.value?.id || row.assetCell.id,
                        keyID: assetField.id,
                        blockID: row.record.itemID,
                        type: "mAsset",
                        mAsset: images,
                    },
                });
            }

            if (updates.length > 0) {
                await this.updateCells(avID, updates);
            }

            return {changed: updates.length, scanned: rows.length};
        } finally {
            this.syncingAvIDs.delete(avID);
        }
    }

    private addAVMenuItem(event: CustomEvent) {
        const detail = event.detail as AVMenuDetail | undefined;
        if (!detail?.menu || !(detail.element instanceof HTMLElement)) {
            return;
        }

        const itemIDs = this.getMenuItemIDs(detail);
        detail.menu.addItem({
            id: "syncContentImages",
            iconHTML: CONTENT_IMAGE_SYNC_ICON,
            label: itemIDs.length > 1 ? this.i18n.syncSelectedContentImages : this.i18n.syncContentImages,
            click: () => {
                this.syncSelectedDatabaseItems(detail.element as HTMLElement, itemIDs).catch((error) => this.showError(error));
            },
        });
    }

    private getMenuItemIDs(detail: AVMenuDetail) {
        const ids = Array.from(detail.selectRowElements || [])
            .map((element) => this.getAVRowItemID(element))
            .filter((id) => id.length > 0);
        return Array.from(new Set(ids));
    }

    private getAVRowItemID(element: Element) {
        return element.getAttribute("data-id") ||
            element.querySelector('[data-dtype="block"] .av__celltext')?.getAttribute("data-id") ||
            "";
    }

    private addImageMenuItem(event: CustomEvent) {
        const detail = event.detail as ImageMenuDetail | undefined;
        if (!detail?.menu || !(detail.element instanceof HTMLElement)) {
            return;
        }

        const asset = this.getImageAssetFromMenuElement(detail.element);
        if (!asset) {
            return;
        }

        detail.menu.addItem({
            id: "appendToContentImages",
            icon: "iconImage",
            label: this.i18n.appendToContentImages,
            click: () => {
                this.appendImageToBoundContentImages(detail, asset).catch((error) => this.showError(error));
            },
        });
    }

    private addContentMenuItem(event: CustomEvent) {
        const detail = event.detail as ContentMenuDetail | undefined;
        if (!detail?.menu || !(detail.element instanceof HTMLElement)) {
            return;
        }

        detail.menu.addItem({
            id: "insertContentImagesFromDatabase",
            iconHTML: CONTENT_IMAGE_INSERT_ICON,
            label: this.i18n.insertContentImagesFromDatabase,
            click: () => {
                this.insertContentImagesFromDatabase(detail).catch((error) => this.showError(error));
            },
        });
    }

    private getImageAssetFromMenuElement(element: HTMLElement) {
        const imgElement = element.querySelector("img");
        if (!imgElement) {
            return undefined;
        }

        const content = imgElement.getAttribute("data-src") || imgElement.getAttribute("src") || "";
        const name = imgElement.getAttribute("title") || imgElement.getAttribute("alt") || "";
        return this.toImageAsset(content, name);
    }

    private async appendImageToBoundContentImages(detail: ImageMenuDetail, asset: AVAsset) {
        await this.appendAssetsToBoundContentImages(detail, [asset]);
    }

    private async insertContentImagesFromDatabase(detail: ContentMenuDetail) {
        const targetBlockID = this.getSelectedContentBlockID(detail);
        if (!targetBlockID) {
            showMessage(this.i18n.noCurrentBlock);
            return;
        }

        const blockIDs = this.getImageContextBlockIDs(detail);
        if (blockIDs.length === 0) {
            showMessage(this.i18n.noCurrentBlock);
            return;
        }

        const entries = await this.getBoundAttributeViewEntries(blockIDs);
        if (entries.length === 0) {
            showMessage(this.i18n.noBoundDatabase);
            return;
        }

        const {matchedFields, sources} = this.getContentImageSources(entries);
        if (matchedFields === 0) {
            showMessage(this.i18n.noBoundAssetField.replace("${field}", this.settingsData.assetFieldName));
            return;
        }

        const usableSources = sources.filter((source) => source.assets.length > 0);
        if (usableSources.length === 0) {
            showMessage(this.i18n.noContentImagesInDatabase);
            return;
        }

        const source = await this.selectContentImageSource(usableSources);
        if (!source) {
            showMessage(this.i18n.selectSourceCanceled);
            return;
        }

        const inserted = await this.insertAssetsAfterBlock(targetBlockID, source.assets);
        if (inserted === 0) {
            showMessage(this.i18n.contentImagesAlreadyInBlock);
            return;
        }

        showMessage(this.i18n.insertSummary.replace("${count}", `${inserted}`));
    }

    private getContentImageSources(entries: BlockAttributeViewKeys[]) {
        const sources: ContentImageSource[] = [];
        const seenTargets = new Set<string>();
        let matchedFields = 0;

        for (const entry of entries) {
            const itemID = this.getItemIDFromKeyValues(entry.keyValues);
            if (!itemID) {
                continue;
            }

            const target = this.findAssetKeyValue(entry.keyValues);
            if (!target) {
                continue;
            }
            matchedFields++;

            const sourceID = `${entry.avID}:${itemID}:${target.field.id}`;
            if (seenTargets.has(sourceID)) {
                continue;
            }
            seenTargets.add(sourceID);

            sources.push({
                id: sourceID,
                avID: entry.avID,
                avName: entry.avName || entry.avID,
                fieldID: target.field.id,
                fieldName: target.field.name || this.settingsData.assetFieldName,
                itemID,
                assets: this.deduplicateAssets(target.value?.mAsset || []),
            });
        }

        return {matchedFields, sources};
    }

    private async selectContentImageSource(sources: ContentImageSource[]) {
        if (sources.length === 1) {
            return sources[0];
        }

        return new Promise<ContentImageSource | undefined>((resolve) => {
            let resolved = false;
            const dialog = new Dialog({
                title: this.i18n.selectContentImageSourceTitle,
                width: "520px",
                content: this.renderSourceDialogContent(sources),
                destroyCallback: () => {
                    if (!resolved) {
                        resolved = true;
                        resolve(undefined);
                    }
                },
            });

            dialog.element.querySelectorAll<HTMLButtonElement>("[data-source-index]").forEach((button) => {
                button.addEventListener("click", () => {
                    const source = sources[Number(button.dataset.sourceIndex)];
                    resolved = true;
                    dialog.destroy();
                    resolve(source);
                });
            });
        });
    }

    private renderSourceDialogContent(sources: ContentImageSource[]) {
        return `<div class="db-content-images__source-dialog">
    <div class="db-content-images__dialog-desc">${this.escapeHtml(this.i18n.selectContentImageSourceDesc)}</div>
    <div class="db-content-images__source-list">
        ${sources.map((source, index) => this.renderSourceButton(source, index)).join("")}
    </div>
</div>`;
    }

    private renderSourceButton(source: ContentImageSource, index: number) {
        const title = this.interpolate(this.i18n.sourceTitle, {
            database: source.avName,
            field: source.fieldName,
        });
        const meta = this.interpolate(this.i18n.sourceMeta, {
            item: source.itemID,
            count: `${source.assets.length}`,
        });
        return `<button class="db-content-images__source" data-source-index="${index}">
    <span class="db-content-images__source-title">${this.escapeHtml(title)}</span>
    <span class="db-content-images__source-meta">${this.escapeHtml(meta)}</span>
</button>`;
    }

    private async appendAssetsToBoundContentImages(detail: ImageMenuDetail, assets: AVAsset[]) {
        const uniqueAssets = this.deduplicateAssets(assets);
        if (uniqueAssets.length === 0) {
            showMessage(this.i18n.noImagesInCurrentDocument);
            return;
        }

        const blockIDs = this.getImageContextBlockIDs(detail);
        if (blockIDs.length === 0) {
            showMessage(this.i18n.noCurrentImageBlock);
            return;
        }

        const entries = await this.getBoundAttributeViewEntries(blockIDs);
        if (entries.length === 0) {
            showMessage(this.i18n.noBoundDatabase);
            return;
        }

        let matchedFields = 0;
        let updated = 0;
        const seenTargets = new Set<string>();
        for (const entry of entries) {
            const itemID = this.getItemIDFromKeyValues(entry.keyValues);
            if (!itemID) {
                continue;
            }

            const target = this.findAssetKeyValue(entry.keyValues);
            if (!target) {
                continue;
            }
            matchedFields++;

            const targetID = `${entry.avID}:${itemID}:${target.field.id}`;
            if (seenTargets.has(targetID)) {
                continue;
            }
            seenTargets.add(targetID);

            const current = target.value?.mAsset || [];
            const next = this.deduplicateAssets([...current, ...uniqueAssets]);
            if (this.sameAssets(current, next)) {
                continue;
            }

            await this.post("/api/av/setAttributeViewBlockAttr", {
                avID: entry.avID,
                keyID: target.field.id,
                itemID,
                value: {
                    id: target.value?.id,
                    keyID: target.field.id,
                    blockID: itemID,
                    type: "mAsset",
                    mAsset: next,
                },
            });
            updated++;
        }

        if (matchedFields === 0) {
            showMessage(this.i18n.noBoundAssetField.replace("${field}", this.settingsData.assetFieldName));
            return;
        }
        if (updated === 0) {
            showMessage(uniqueAssets.length > 1 ? this.i18n.imagesAlreadyInContentImages : this.i18n.imageAlreadyInContentImages);
            return;
        }

        showMessage(this.i18n.appendSummary.replace("${updated}", `${updated}`).replace("${scanned}", `${matchedFields}`));
    }

    private getImageContextBlockIDs(detail: ImageMenuDetail) {
        const ids: string[] = [];
        const blockElement = detail.element?.closest("[data-node-id]");
        const blockID = blockElement?.getAttribute("data-node-id") || "";
        const rootID = detail.protyle?.block?.rootID || "";
        if (blockID) {
            ids.push(blockID);
        }
        if (rootID) {
            ids.push(rootID);
        }
        return Array.from(new Set(ids));
    }

    private getSelectedContentBlockID(detail: ContentMenuDetail) {
        return detail.element?.closest("[data-node-id]")?.getAttribute("data-node-id") ||
            detail.protyle?.selectElement?.getAttribute("data-node-id") ||
            "";
    }

    private async getBoundAttributeViewEntries(blockIDs: string[]) {
        const entries: BlockAttributeViewKeys[] = [];
        const seen = new Set<string>();
        for (const id of blockIDs) {
            const blockEntries = await this.post<BlockAttributeViewKeys[]>("/api/av/getAttributeViewKeys", {id});
            for (const entry of blockEntries || []) {
                const itemID = this.getItemIDFromKeyValues(entry.keyValues);
                const key = `${entry.avID}:${itemID}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                entries.push(entry);
            }
        }
        return entries;
    }

    private getItemIDFromKeyValues(keyValues: AVKeyValues[]) {
        return keyValues
            .find((keyValue) => keyValue.key?.type === "block")
            ?.values?.[0]?.blockID || "";
    }

    private findAssetKeyValue(keyValues: AVKeyValues[]) {
        const field = this.findAssetField(keyValues.map((keyValue) => keyValue.key).filter(Boolean));
        if (!field) {
            return undefined;
        }

        const keyValue = keyValues.find((item) => item.key?.id === field.id);
        return {
            field,
            value: keyValue?.values?.[0],
        };
    }

    private async renderAttributeView(element: HTMLElement) {
        return this.post<AVRenderData>("/api/av/renderAttributeView", {
            id: element.getAttribute("data-av-id"),
            blockID: element.getAttribute("data-node-id") || "",
            viewID: this.getViewID(element),
            pageSize: -1,
            createIfNotExist: false,
        });
    }

    private getViewID(element: HTMLElement) {
        return element.getAttribute(CUSTOM_SY_AV_VIEW) ||
            element.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id") ||
            "";
    }

    private getFields(view: AVView): AVColumn[] {
        if (Array.isArray(view.columns) && view.columns.length > 0) {
            return view.columns;
        }
        if (Array.isArray(view.fields) && view.fields.length > 0) {
            return view.fields;
        }
        for (const group of view.groups || []) {
            const fields = this.getFields(group);
            if (fields.length > 0) {
                return fields;
            }
        }
        return [];
    }

    private findAssetField(fields: AVColumn[]) {
        const configuredName = this.settingsData.assetFieldName.trim();
        const named = fields.find((field) => field.type === "mAsset" && field.name === configuredName);
        if (named) {
            return named;
        }

        const assetFields = fields.filter((field) => field.type === "mAsset");
        if (configuredName === DEFAULT_ASSET_FIELD_NAME && assetFields.length === 1) {
            return assetFields[0];
        }
        return undefined;
    }

    private collectRecords(view: AVView): SyncRecord[] {
        const records: SyncRecord[] = [];
        for (const row of view.rows || []) {
            records.push({itemID: row.id, cells: row.cells || []});
        }
        for (const card of view.cards || []) {
            records.push({itemID: card.id, cells: card.values || []});
        }
        for (const group of view.groups || []) {
            records.push(...this.collectRecords(group));
        }
        return records;
    }

    private collectBoundRows(records: SyncRecord[], fieldIndex: number, assetFieldID: string) {
        const rows: Array<{
            record: SyncRecord;
            boundBlockID: string;
            assetCell: AVCell;
        }> = [];

        for (const record of records) {
            const blockCell = record.cells.find((cell) => cell.valueType === "block" && cell.value?.block?.id);
            if (!blockCell?.value?.block?.id || blockCell.value.isDetached) {
                continue;
            }

            const assetCell = record.cells[fieldIndex] ||
                record.cells.find((cell) => cell.value?.keyID === assetFieldID || cell.valueType === "mAsset");
            if (!assetCell) {
                continue;
            }

            rows.push({
                record,
                boundBlockID: blockCell.value.block.id,
                assetCell,
            });
        }

        return rows;
    }

    private async collectImages(boundBlockIDs: string[]) {
        const ids = Array.from(new Set(boundBlockIDs.filter(Boolean)));
        const imageMap = new Map<string, AVAsset[]>();
        ids.forEach((id) => imageMap.set(id, []));

        if (ids.length === 0) {
            return imageMap;
        }

        await Promise.all([
            this.collectKramdownImages(ids, imageMap),
            this.collectIndexedAssets(ids, imageMap),
        ]);

        for (const [id, assets] of imageMap.entries()) {
            imageMap.set(id, this.deduplicateAssets(assets));
        }
        return imageMap;
    }

    private async collectKramdownImages(ids: string[], imageMap: Map<string, AVAsset[]>) {
        try {
            const kramdowns = await this.post<Record<string, string>>("/api/block/getBlockKramdowns", {
                ids,
                mode: "md",
            });
            for (const id of ids) {
                const assets = this.extractImageLinks(kramdowns[id] || "");
                imageMap.get(id)?.push(...assets);
            }
        } catch (error) {
            console.debug(`[${this.name}] getBlockKramdowns failed`, error);
        }
    }

    private async collectIndexedAssets(ids: string[], imageMap: Map<string, AVAsset[]>) {
        const quotedIDs = ids.map((id) => this.sqlString(id)).join(",");
        const stmt = `SELECT root_id, block_id, path, name, title FROM assets WHERE root_id IN (${quotedIDs}) OR block_id IN (${quotedIDs}) ORDER BY id`;

        try {
            const rows = await this.post<AssetRow[]>("/api/query/sql", {stmt});
            for (const row of rows) {
                const asset = this.toImageAsset(row.path || "", row.name || row.title || "");
                if (!asset) {
                    continue;
                }
                for (const id of ids) {
                    if (row.root_id === id || row.block_id === id) {
                        imageMap.get(id)?.push(asset);
                    }
                }
            }
        } catch (error) {
            console.debug(`[${this.name}] asset SQL query failed`, error);
        }
    }

    private async updateCells(avID: string, values: BatchValue[]) {
        try {
            await this.post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID,
                values,
            });
            return;
        } catch (error) {
            console.debug(`[${this.name}] batch update failed, falling back`, error);
        }

        for (const value of values) {
            await this.post("/api/av/setAttributeViewBlockAttr", {
                avID,
                ...value,
            });
        }
    }

    private async insertAssetsAfterBlock(blockID: string, assets: AVAsset[]) {
        const existingContents = await this.getNearbyImageContents(blockID, assets.length + 8);
        const assetsToInsert = assets.filter((asset) => !existingContents.has(asset.content));
        if (assetsToInsert.length === 0) {
            return 0;
        }

        const data = assetsToInsert.map((asset) => this.toImageMarkdown(asset)).join("\n\n");
        await this.post<InsertBlockTransaction[]>("/api/block/insertBlock", {
            dataType: "markdown",
            data,
            previousID: blockID,
            nextID: "",
            parentID: "",
        });
        return assetsToInsert.length;
    }

    private async getNearbyImageContents(blockID: string, nearbyCount: number) {
        const contents = new Set<string>();
        try {
            const rows = await this.getNearbyMarkdownRows(blockID, Math.max(16, nearbyCount));
            for (const row of rows) {
                for (const asset of this.extractImageLinks(row.markdown || "")) {
                    contents.add(asset.content);
                }
            }
        } catch (error) {
            console.debug(`[${this.name}] nearby image query failed`, error);
        }
        return contents;
    }

    private async getNearbyMarkdownRows(blockID: string, limit: number) {
        const currentRows = await this.post<BlockMarkdownRow[]>("/api/query/sql", {
            stmt: `SELECT id, parent_id, sort, markdown FROM blocks WHERE id = ${this.sqlString(blockID)} LIMIT 1`,
        });
        const current = currentRows[0];
        if (!current) {
            return [];
        }

        const parentID = current.parent_id || "";
        const rawSort = Number(current.sort || 0);
        const sort = isFinite(rawSort) ? rawSort : 0;
        const safeLimit = Math.max(1, Math.floor(limit));
        return this.post<BlockMarkdownRow[]>("/api/query/sql", {
            stmt: `SELECT id, markdown FROM blocks WHERE parent_id = ${this.sqlString(parentID)} AND sort >= ${sort} ORDER BY sort LIMIT ${safeLimit}`,
        });
    }

    private toImageMarkdown(asset: AVAsset) {
        const alt = asset.name.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
        const destination = /[\s()<>]/.test(asset.content) ? `<${asset.content.replace(/>/g, "%3E")}>` : asset.content;
        return `![${alt}](${destination})`;
    }

    private extractImageLinks(markdown: string) {
        const assets: AVAsset[] = [];
        const markdownImage = /!\[[^\]]*]\(([^)]*)\)/g;
        let match: RegExpExecArray | null;
        while ((match = markdownImage.exec(markdown)) !== null) {
            const asset = this.toImageAsset(this.normalizeMarkdownDestination(match[1]));
            if (asset) {
                assets.push(asset);
            }
        }

        const htmlImage = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
        while ((match = htmlImage.exec(markdown)) !== null) {
            const asset = this.toImageAsset(match[2]);
            if (asset) {
                assets.push(asset);
            }
        }

        return this.deduplicateAssets(assets);
    }

    private normalizeMarkdownDestination(destination: string) {
        let value = destination.trim();
        if (value.startsWith("<") && value.endsWith(">")) {
            value = value.slice(1, -1);
        }
        const titleIndex = value.search(/\s+["'][^"']*["']\s*$/);
        if (titleIndex > 0) {
            value = value.slice(0, titleIndex);
        }
        return this.decodeHtml(value);
    }

    private toImageAsset(content: string, name = ""): AVAsset | undefined {
        const cleaned = this.decodeHtml(content.trim());
        if (!cleaned || !this.isImagePath(cleaned)) {
            return undefined;
        }

        return {
            type: "image",
            name: name.trim() || this.basename(cleaned),
            content: cleaned,
        };
    }

    private isImagePath(path: string) {
        const lower = path.split("#")[0].split("?")[0].toLowerCase();
        return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    }

    private basename(path: string) {
        const withoutQuery = path.split("#")[0].split("?")[0];
        const normalized = withoutQuery.replace(/\\/g, "/");
        const name = normalized.slice(normalized.lastIndexOf("/") + 1);
        try {
            return decodeURIComponent(name);
        } catch {
            return name;
        }
    }

    private deduplicateAssets(assets: AVAsset[]) {
        const seen = new Set<string>();
        const deduped: AVAsset[] = [];
        for (const asset of assets) {
            if (seen.has(asset.content)) {
                continue;
            }
            seen.add(asset.content);
            deduped.push(asset);
        }
        return deduped;
    }

    private sameAssets(left: AVAsset[], right: AVAsset[]) {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((asset, index) =>
            asset.type === right[index].type &&
            asset.name === right[index].name &&
            asset.content === right[index].content);
    }

    private findCurrentAVElement() {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode;
        if (anchor) {
            const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
            const avElement = element?.closest(".av[data-av-id]");
            if (avElement instanceof HTMLElement) {
                return avElement;
            }
        }

        const activeElement = document.activeElement;
        const activeAV = activeElement?.closest?.(".av[data-av-id]");
        if (activeAV instanceof HTMLElement) {
            return activeAV;
        }

        return document.querySelector(".protyle:not(.fn__none) .av[data-av-id]") as HTMLElement ||
            document.querySelector(".av[data-av-id]") as HTMLElement | null;
    }

    private findVisibleAVElements() {
        const elements = Array.from(document.querySelectorAll(".av[data-av-id]")) as HTMLElement[];
        const seen = new Set<string>();
        return elements.filter((element) => {
            const id = element.getAttribute("data-av-id") || "";
            if (!id || seen.has(id) || element.offsetParent === null) {
                return false;
            }
            seen.add(id);
            return true;
        });
    }

    private handleWsEvent(event: CustomEvent) {
        if (!this.settingsData.autoSyncVisible || !this.isAttrViewMutation(event.detail)) {
            return;
        }

        window.clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = window.setTimeout(() => {
            this.syncVisibleDatabases().catch((error) => this.showError(error));
        }, 800);
    }

    private isAttrViewMutation(detail: unknown) {
        const data = detail as {cmd?: string; data?: Array<{doOperations?: Array<{action?: string}>}>} | undefined;
        if (data?.cmd !== "transactions" || !Array.isArray(data.data)) {
            return false;
        }

        return data.data.some((transaction) =>
            (transaction.doOperations || []).some((operation) =>
                operation.action === "insertAttrViewBlock" ||
                operation.action === "updateAttrViewCell" ||
                operation.action === "setAttrViewBlockView" ||
                (operation.action || "").startsWith("setAttrViewCol")));
    }

    private post<T>(url: string, data: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            fetchPost(url, data, (response: SiyuanResponse<T>) => {
                if (response.code !== 0) {
                    reject(new Error(response.msg || `${url} failed with code ${response.code}`));
                    return;
                }
                resolve(response.data);
            });
        });
    }

    private sqlString(value: string) {
        return `'${value.replace(/'/g, "''")}'`;
    }

    private decodeHtml(value: string) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = value;
        return textarea.value;
    }

    private escapeHtml(value: string) {
        const div = document.createElement("div");
        div.textContent = value;
        return div.innerHTML;
    }

    private interpolate(template: string, values: Record<string, string>) {
        return template.replace(/\$\{(\w+)}/g, (match, key) => values[key] ?? match);
    }

    private showSyncResult(result: {changed: number; scanned: number}) {
        showMessage(this.i18n.syncSummary.replace("${changed}", `${result.changed}`).replace("${scanned}", `${result.scanned}`));
    }

    private showError(error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showMessage(`${this.name}: ${message}`);
    }
}

# DB Content Images

DB Content Images syncs document images to the asset field of their bound SiYuan database. It is useful for literature databases, material collections, project trackers, and other databases that need image previews from the bound note content.

The plugin stores only paths or links to existing image assets. It does not copy images or create new attachment files.

## Features

- Manual sync: right-click a database item and run `Plugin > Sync Content Images` to write images from the bound document into the asset field.
- Auto-sync: after enabling `Auto-sync document images`, document image additions, replacements, and confirmed deletions are synced to bound database items.
- Delayed retry: if the matching database is not open when the document changes, the plugin stores the bound item in a pending queue and retries when the database opens.
- Empty-result guard: the asset field is cleared only when persisted document content confirms there are no images, avoiding false clears caused by editor re-rendering or virtual scrolling.

## Usage

1. Create an asset field in the target database. The default field name is `内容图`.
2. Add the document or block whose images you want to sync to that database.
3. Right-click a database item and run `Plugin > Sync Content Images`, or run `Sync Current DB Content Images` from the command palette.
4. To use a different asset field, change `Asset field name` in the plugin settings.
5. To sync after document image changes, enable `Auto-sync document images` in the plugin settings.

When auto-sync is triggered, the plugin first checks whether the changed block or current document root is bound to a database item. Unbound documents are skipped silently: they are not stored in the pending queue and do not trigger scans or refreshes of opened databases. When a binding exists, the plugin first syncs matching opened database items, then tries a direct bound-item write; if the bound item cannot be synced immediately, it is saved in a cross-restart pending queue and retried when the matching database opens.

Use a dedicated asset field such as `内容图`. `Replace existing assets` only affects manual sync from the database context menu or command palette; auto-sync clears confirmed empty document content and otherwise keeps the empty-result guard enabled.

## Notes

This plugin was mainly generated with AI and is tested, adjusted, published, and maintained by the author. It uses public SiYuan APIs and does not modify the SiYuan kernel, so it cannot add native database column settings or native toggles to the field menu.

Contact:

`1092242849@qq.com`

If this plugin helps you, support is welcome:

| WeChat Pay | Alipay |
| --- | --- |
| <img src="/plugins/siyuan-db-content-images/assets/wechat-pay.png" width="260" alt="WeChat Pay QR code"> | <img src="/plugins/siyuan-db-content-images/assets/alipay.jpg" width="260" alt="Alipay QR code"> |

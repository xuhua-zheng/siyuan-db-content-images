# DB Content Images

Sync images inserted in a bound note/block into a SiYuan database asset field.

## Usage

1. Create an asset field in the target database. The default field name is `内容图`.
2. Add notes or blocks to the database.
3. Right-click a database item and run `Plugin > Sync Content Images`, or run `Sync Current DB Content Images` from the command palette.
4. To use a different field, change `Asset field name` in the plugin settings.
5. Enable `Auto-sync document images` if you want bound database items to update after document image changes.

The plugin reads the bound block for each database row, extracts Markdown images, HTML images, and indexed asset images, then writes them to the configured asset field.

Auto-sync listens for document image changes. After a trigger, it first uses the same sync path as the database context menu for matching rows in opened databases, including background tabs. The database does not need to be shown side-by-side with the document. If no matching row is found but opened databases exist, it syncs those opened databases; if no opened database exists, it falls back to bound-block lookup. Auto-sync reads persisted document content first, so confirmed image deletion clears the asset field; it still avoids clearing existing asset values just because the editor re-rendered, virtual scrolling unloaded DOM nodes, or one uncertain collection pass returned empty. The plugin only stores links/paths to existing image assets; it does not copy or create attachment files.

Use a dedicated asset field for this. `Replace existing assets` only affects manual sync from the database context menu or command palette; auto-sync clears confirmed empty document content and otherwise keeps the empty-result guard enabled.

## Limitation

Plugins cannot add a native SiYuan database field setting. This plugin uses public APIs to synchronize a normal asset field, which makes it suitable for a no-kernel-change packaged plugin.

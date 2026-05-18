# DB Content Images

Sync images inserted in a bound note/block into a SiYuan database asset field.

## Usage

1. Create an asset field in the target database. The default field name is `内容图`.
2. Add notes or blocks to the database.
3. Right-click a database item and run `Plugin > Sync Content Images`, or run `Sync Current DB Content Images` from the command palette.
4. To use a different field, change `Asset field name` in the plugin settings.
5. Enable `Auto-sync visible databases` if you want visible databases to be synced after database row or field changes.

The plugin reads the bound block for each database row, extracts Markdown images, HTML images, and indexed asset images, then writes them to the configured asset field.

You can also use the editor context menu:

- Right-click an image and run `Plugin > Append to Content Images` to append that image to matching database items.
- Right-click normal document/block content and run `Plugin > Insert Images from Content Images` to insert images from the bound database `内容图` asset field as image blocks after the selected block. If multiple database/field sources are available, the plugin asks which one to use.

Both entries check databases bound to the image/block and current document.

Sync and insertion use links/paths to existing image assets. The plugin does not copy or create new attachment files.

Use a dedicated asset field for this. By default the plugin replaces existing values so the field reflects the note content; turn off `Replace existing assets` to skip cells that already contain assets.

## Limitation

Plugins cannot add a native SiYuan database field setting. This plugin uses public APIs to synchronize a normal asset field, which makes it suitable for a no-kernel-change packaged plugin.

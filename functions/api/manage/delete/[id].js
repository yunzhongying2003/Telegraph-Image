import { extractKey, isShortId } from "../../../utils/helpers";

/**
 * GET /api/manage/delete/{id} — 删除图片
 * 兼容新旧 ID 格式
 */
export async function onRequest(context) {
    const { params, env } = context;
    const key = extractKey(params.id);
    if (!key) {
        return new Response('Invalid ID', { status: 400 });
    }

    try {
        // 短 ID 格式：直接按短 ID 删除
        if (isShortId(key)) {
            const record = await env.img_url.getWithMetadata(key);
            if (record && record.metadata && record.metadata.file_id) {
                // 删除反向映射
                await env.img_url.delete(`_fileid:${record.metadata.file_id}`);
            }
            await env.img_url.delete(key);
            return new Response('ok');
        }

        // 旧格式：key 是 file_id.ext
        // 尝试查找反向映射
        const shortId = await env.img_url.get(`_fileid:${key}`);
        if (shortId) {
            await env.img_url.delete(shortId);
            await env.img_url.delete(`_fileid:${key}`);
        }
        // 也删除旧格式的 KV 条目
        await env.img_url.delete(key);
        // 尝试带扩展名的版本
        const ext = params.id.includes('.') ? params.id.split('.').pop() : '';
        if (ext) {
            await env.img_url.delete(`${key}.${ext}`);
        }

        return new Response('ok');
    } catch (e) {
        console.error('Delete error:', e);
        return new Response('Internal error', { status: 500 });
    }
}
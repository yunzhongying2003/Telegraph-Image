import { extractKey, isShortId } from "../../../utils/helpers";

/**
 * GET /api/manage/block/{id} — 将图片加入黑名单
 */
export async function onRequest(context) {
    const { params, env } = context;
    const key = extractKey(params.id);
    if (!key) return new Response('Invalid ID', { status: 400 });

    try {
        if (isShortId(key)) {
            const record = await env.img_url.getWithMetadata(key);
            if (record && record.metadata) {
                record.metadata.list_type = 'Block';
                await env.img_url.put(key, '', { metadata: record.metadata });
                return new Response(JSON.stringify(record.metadata));
            }
            return new Response('Not found', { status: 404 });
        }

        // 旧格式
        const record = await env.img_url.getWithMetadata(key);
        if (record && record.metadata) {
            record.metadata.list_type = 'Block';
            await env.img_url.put(key, '', { metadata: record.metadata });
            return new Response(JSON.stringify(record.metadata));
        }
        return new Response('Not found', { status: 404 });
    } catch (e) {
        console.error('Block error:', e);
        return new Response('Internal error', { status: 500 });
    }
}
import { extractKey, isShortId } from "../../../utils/helpers";

/**
 * GET /api/manage/toggleLike/{id} — 切换点赞状态
 */
export async function onRequest(context) {
    const { params, env } = context;
    const key = extractKey(params.id);
    if (!key) return new Response('Invalid ID', { status: 400 });

    try {
        if (isShortId(key)) {
            const record = await env.img_url.getWithMetadata(key);
            if (record && record.metadata) {
                record.metadata.liked = !record.metadata.liked;
                await env.img_url.put(key, '', { metadata: record.metadata });
                return new Response(String(record.metadata.liked));
            }
            return new Response('Not found', { status: 404 });
        }

        const record = await env.img_url.getWithMetadata(key);
        if (record && record.metadata) {
            record.metadata.liked = !record.metadata.liked;
            await env.img_url.put(key, '', { metadata: record.metadata });
            return new Response(String(record.metadata.liked));
        }
        return new Response('Not found', { status: 404 });
    } catch (e) {
        console.error('ToggleLike error:', e);
        return new Response('Internal error', { status: 500 });
    }
}
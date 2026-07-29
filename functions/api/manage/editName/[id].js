import { extractKey, isShortId } from "../../../utils/helpers";

/**
 * GET /api/manage/editName/{id}?name=新名称
 * 修改图片文件名（仅新短 ID 格式支持）
 */
export async function onRequest(context) {
    const { params, env, request } = context;
    const url = new URL(request.url);
    const key = extractKey(params.id);
    const newName = url.searchParams.get('name');

    if (!key || !newName) {
        return new Response('Missing ID or name parameter', { status: 400 });
    }

    try {
        if (isShortId(key)) {
            const record = await env.img_url.getWithMetadata(key);
            if (record && record.metadata) {
                record.metadata.file_name = newName;
                await env.img_url.put(key, '', { metadata: record.metadata });
                return new Response(JSON.stringify(record.metadata));
            }
            return new Response('Not found', { status: 404 });
        }
        return new Response('Old format does not support rename', { status: 400 });
    } catch (e) {
        console.error('EditName error:', e);
        return new Response('Internal error', { status: 500 });
    }
}
import { extractKey, isShortId } from "../../utils/helpers";

/**
 * GET /api/manage/list — 列出图片
 * 参数: limit, cursor, prefix
 * 返回新格式兼容结果
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    let raw = url.searchParams.get('limit');
    let limit = parseInt(raw || '100', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 1000) limit = 1000;

    const cursor = url.searchParams.get('cursor') || undefined;
    const prefix = url.searchParams.get('prefix') || undefined;

    // 如果 prefix 是短 ID 格式，直接按短 ID 查
    if (prefix && prefix.length <= 12) {
        const value = await env.img_url.list({ limit, cursor, prefix });
        // 格式化结果
        const keys = (value.keys || []).map(k => ({
            name: k.name,
            metadata: k.metadata ? JSON.stringify(k.metadata) : '',
            expiration: k.expiration,
        }));
        return new Response(JSON.stringify({ ...value, keys }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 普通查询（兼容旧格式）
    const value = await env.img_url.list({ limit, cursor, prefix });
    const keys = (value.keys || []).map(k => ({
        name: k.name,
        metadata: k.metadata ? JSON.stringify(k.metadata) : '',
        expiration: k.expiration,
    }));

    return new Response(JSON.stringify({ ...value, keys }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
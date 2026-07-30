import { extractKey, isShortId } from "../../utils/helpers";

/**
 * GET /api/manage/list — 列出图片
 * 参数: limit, cursor, prefix, filter
 * filter: all | block | white
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
    const filter = url.searchParams.get('filter') || 'all';

    // 短 ID 前缀模式：直接按 prefix 查询，前端负责过滤
    if (prefix && prefix.length <= 12) {
        const value = await env.img_url.list({ limit: limit * 10, cursor, prefix });
        const keys = (value.keys || []).map(k => ({
            name: k.name,
            metadata: k.metadata ? JSON.stringify(k.metadata) : '',
            expiration: k.expiration,
        }));
        return new Response(JSON.stringify({ ...value, keys }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 需要遍历所有键并过滤
    let allKeys = [];
    let listCursor;
    do {
        const result = await env.img_url.list({ limit: 1000, cursor: listCursor });
        const filtered = (result.keys || []).filter(k => {
            if (k.name.startsWith('_')) return false;
            if (filter === 'all') return true;
            const meta = k.metadata || {};
            const listType = meta.list_type || '';
            const label = meta.label || '';
            if (filter === 'block') return listType === 'Block' || label === 'blocked';
            if (filter === 'white') return listType === 'White';
            return true;
        });
        allKeys = allKeys.concat(filtered);
        listCursor = result.cursor;
        if (allKeys.length >= limit) break;
    } while (listCursor);

    const keys = allKeys.slice(0, limit).map(k => ({
        name: k.name,
        metadata: k.metadata ? JSON.stringify(k.metadata) : '',
        expiration: k.expiration,
    }));
    return new Response(JSON.stringify({
        keys,
        cursor: allKeys.length > limit ? allKeys[limit].name : undefined,
        list_complete: allKeys.length <= limit,
    }), { headers: { 'Content-Type': 'application/json' } });
}
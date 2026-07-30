import { extractKey, isShortId } from "../../utils/helpers";

/**
 * GET /api/manage/list — 列出图片
 * 参数: limit, cursor, prefix, filter
 * filter: all | block | white | today
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    let raw = url.searchParams.get('limit');
    let limit = parseInt(raw || '100', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 1000) limit = 1000;

    const reqCursor = url.searchParams.get('cursor') || undefined;
    const prefix = url.searchParams.get('prefix') || undefined;
    const filter = url.searchParams.get('filter') || 'all';

    // 短 ID 前缀模式：直接按 prefix 查询
    if (prefix && prefix.length <= 12) {
        const value = await env.img_url.list({ limit: limit * 10, cursor: reqCursor, prefix });
        const keys = (value.keys || []).map(k => ({
            name: k.name,
            metadata: k.metadata ? JSON.stringify(k.metadata) : '',
            expiration: k.expiration,
        }));
        return new Response(JSON.stringify({ ...value, keys }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 今日日期（用于 today 筛选）
    const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 遍历 KV 并过滤
    let allKeys = [];
    let kvCursor = reqCursor; // 从请求的 cursor 开始
    let hasMore = false;
    do {
        const result = await env.img_url.list({ limit: 1000, cursor: kvCursor });
        const filtered = (result.keys || []).filter(k => {
            if (k.name.startsWith('_')) return false;
            if (filter === 'all') return true;
            const meta = k.metadata || {};
            const listType = meta.list_type || '';
            const label = meta.label || '';
            if (filter === 'block') return listType === 'Block' || label === 'blocked';
            if (filter === 'white') return listType === 'White';
            if (filter === 'today') {
                const ts = meta.upload_time || meta.timestamp || meta.created_at || '';
                if (!ts) return false;
                const tsDate = typeof ts === 'number'
                    ? new Date(ts).toISOString().slice(0, 10)
                    : String(ts).slice(0, 10);
                return tsDate === todayPrefix;
            }
            return true;
        });
        allKeys = allKeys.concat(filtered);
        kvCursor = result.cursor; // 保存原始 KV 游标
        if (allKeys.length > limit) {
            hasMore = true;
            allKeys = allKeys.slice(0, limit); // 只取 limit 条
            break;
        }
    } while (kvCursor);

    const keys = allKeys.map(k => ({
        name: k.name,
        metadata: k.metadata ? JSON.stringify(k.metadata) : '',
        expiration: k.expiration,
    }));

    return new Response(JSON.stringify({
        keys,
        cursor: hasMore ? kvCursor : undefined,
        list_complete: !hasMore,
    }), { headers: { 'Content-Type': 'application/json' } });
}
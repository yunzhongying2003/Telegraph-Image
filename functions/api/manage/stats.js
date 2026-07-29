/**
 * GET /api/manage/stats — 获取统计信息
 *
 * 返回:
 *   total      - 总图片数
 *   today      - 今日上传数
 *   blocked    - 被封禁数
 *   whitelisted - 白名单数
 *   kv_keys    - KV 中总条目数
 */
export async function onRequest(context) {
    const { env } = context;

    try {
        // 从计数器读取
        const total = parseInt((await env.img_url.get('_counter:total')) || '0', 10);
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const today = parseInt((await env.img_url.get(`_counter:today:${dateStr}`)) || '0', 10);

        // 统计被封禁和白名单（通过游标遍历）
        let blocked = 0;
        let whitelisted = 0;
        let cursor;

        do {
            const result = await env.img_url.list({ limit: 1000, cursor });
            const keys = result.keys || [];
            for (const key of keys) {
                // 跳过计数器键（以 _ 开头）
                if (key.name.startsWith('_')) continue;
                if (key.metadata) {
                    if (key.metadata.list_type === 'Block') blocked++;
                    if (key.metadata.list_type === 'White') whitelisted++;
                }
            }
            cursor = result.cursor;
        } while (cursor);

        // 总 KV 条目数
        let kvKeys = 0;
        cursor = undefined;
        do {
            const result = await env.img_url.list({ limit: 1000, cursor });
            kvKeys += (result.keys || []).length;
            cursor = result.cursor;
        } while (cursor);

        return new Response(JSON.stringify({
            total,
            today,
            blocked,
            whitelisted,
            kv_keys: kvKeys,
        }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        console.error('Stats error:', e);
        // 兜底
        return new Response(JSON.stringify({ total: 0, today: 0, blocked: 0, whitelisted: 0, kv_keys: 0 }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
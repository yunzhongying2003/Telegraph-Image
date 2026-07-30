/**
 * GET /api/manage/stats — 获取统计信息
 *
 * 返回:
 *   total        - KV 中所有图片条目数（非计数器）
 *   today        - 今日上传数（按上传时间戳 metadata.upload_time 或 metadata.timestamp）
 *   blocked      - 被封禁数
 *   whitelisted  - 白名单数
 */
export async function onRequest(context) {
    const { env } = context;
    try {
        const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        let total = 0;
        let today = 0;
        let blocked = 0;
        let whitelisted = 0;
        let cursor;

        do {
            const result = await env.img_url.list({ limit: 1000, cursor });
            const keys = result.keys || [];
            for (const key of keys) {
                // 跳过计数器键（以 _ 开头）
                if (key.name.startsWith('_')) continue;
                total++;

                const meta = key.metadata || {};
                if (meta.list_type === 'Block' || meta.label === 'blocked') blocked++;
                if (meta.list_type === 'White') whitelisted++;

                // 今日统计：timestamp 是 Date.now() 的数字毫秒值，转成日期字符串比较
                const ts = meta.upload_time || meta.timestamp || meta.created_at || '';
                if (ts) {
                    let tsDate = '';
                    if (typeof ts === 'number') {
                        tsDate = new Date(ts).toISOString().slice(0, 10);
                    } else if (typeof ts === 'string') {
                        // 已经是 YYYY-MM-DD 格式
                        tsDate = ts.slice(0, 10);
                    }
                    if (tsDate === todayPrefix) today++;
                }
            }
            cursor = result.cursor;
        } while (cursor);

        return new Response(JSON.stringify({
            total,
            today,
            blocked,
            whitelisted,
        }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        console.error('Stats error:', e);
        return new Response(JSON.stringify({ total: 0, today: 0, blocked: 0, whitelisted: 0 }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
import { extractKey, isShortId } from "../../../utils/helpers";

/**
 * POST /api/manage/editMeta/{id} — 编辑图片元数据
 * 
 * 认证: Authorization: Bearer *** 或 Basic Auth（通过 _middleware.js）
 * 
 * 请求体 (JSON):
 * {
 *   "keywords": ["老挝", "寺庙", "佛像"],
 *   "scene": "香通寺金色屋顶全景",
 *   "file_name": "新文件名",
 *   "label": "travel"
 * }
 * 
 * 返回: 更新后的 metadata 对象
 */
export async function onRequest(context) {
    const { params, env, request } = context;
    const key = extractKey(params.id);
    
    if (!key || !env.img_url) {
        return new Response('Missing key or KV namespace', { status: 400 });
    }
    
    // 认证已由 _middleware.js 处理，此处信任上下文
    
    try {
        let record = await env.img_url.getWithMetadata(key);
        
        if (!record) {
            // 旧格式或无记录：创建新记录
            const meta = await request.json();
            const now = Date.now();
            const newMeta = {
                file_name: meta.file_name || key,
                file_size: 0,
                ext: '',
                timestamp: now,
                list_type: 'None',
                label: 'normal',
                liked: false,
                keywords: meta.keywords || [],
                scene: meta.scene || '',
            };
            await env.img_url.put(key, '', { metadata: newMeta });
            return new Response(JSON.stringify(newMeta), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        
        // 合并更新
        const existingMeta = record.metadata || {};
        const meta = await request.json();
        
        const updatedMeta = {
            ...existingMeta,
            ...(meta.keywords !== undefined && { keywords: Array.isArray(meta.keywords) ? meta.keywords : [] }),
            ...(meta.scene !== undefined && { scene: meta.scene }),
            ...(meta.file_name && { file_name: meta.file_name }),
            ...(meta.label && { label: meta.label }),
        };
        
        await env.img_url.put(key, '', { metadata: updatedMeta });
        
        return new Response(JSON.stringify(updatedMeta), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        console.error('EditMeta error:', e);
        return new Response('Internal error: ' + e.message, { status: 500 });
    }
}

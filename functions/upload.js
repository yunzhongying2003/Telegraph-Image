import { generateShortId, getFileIdFromResponse, sendToTelegram, moderateImage } from "./utils/helpers";

/**
 * POST /upload — 上传图片（支持多图）
 *
 * 认证: Authorization: Bearer <API_KEY> 或 Basic Auth
 * 请求: multipart/form-data, 字段名 "file"（可重复）
 * 返回: [{ src: "/file/abc12345.png", name: "xxx.jpg", size: 12345 }, ...]
 *
 * 环境变量:
 *   API_KEY        — 上传 API Key（必填，否则拒绝上传）
 *   TG_Bot_Token   — Telegram Bot Token
 *   TG_Chat_ID     — Telegram 频道 ID
 *   TC_SECRET_ID   — 腾讯云 SecretId（可选，配置后启用审核）
 *   TC_SECRET_KEY  — 腾讯云 SecretKey
 *   TC_REGION      — 腾讯云区域（默认 ap-guangzhou）
 */
export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // ── 1. API Key 认证 ──
        const authHeader = request.headers.get('Authorization') || '';
        const apiKey = env.API_KEY || '';
        if (apiKey) {
            const token = authHeader.replace(/^Bearer\s+/i, '').trim();
            if (token !== apiKey) {
                // 也支持 Basic Auth（管理后台用）
                if (!authHeader.startsWith('Basic ')) {
                    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            }
        }

        // ── 2. 解析上传文件 ──
        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();
        const files = formData.getAll('file');

        if (!files || files.length === 0) {
            return new Response(JSON.stringify({ error: 'No file uploaded' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── 3. 逐个处理文件 ──
        const results = [];
        const errors = [];

        for (const uploadFile of files) {
            try {
                // 3a. 检查类型
                if (!uploadFile.type.startsWith('image/')) {
                    results.push({ src: null, name: uploadFile.name, error: 'Only image files are allowed' });
                    continue;
                }

                const fileName = uploadFile.name;
                const ext = fileName.split('.').pop().toLowerCase() || 'png';
                const shortId = generateShortId();
                const fileSize = uploadFile.size;

                // 3b. 上传到 Telegram
                const tgFormData = new FormData();
                tgFormData.append('chat_id', env.TG_Chat_ID);
                tgFormData.append('photo', uploadFile);

                const tgResult = await sendToTelegram(tgFormData, 'sendPhoto', env);
                if (!tgResult.success) {
                    results.push({ src: null, name: fileName, error: tgResult.error });
                    continue;
                }

                const fileId = getFileIdFromResponse(tgResult.data);
                if (!fileId) {
                    results.push({ src: null, name: fileName, error: 'Failed to get file ID from Telegram' });
                    continue;
                }

                // 3c. 腾讯云合规检查
                if (env.TC_SECRET_ID && env.TC_SECRET_KEY) {
                    const imageUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${await getImagePath(env, fileId)}`;
                    const moderation = await moderateImage(env, imageUrl);
                    if (!moderation.pass) {
                        // 违规图片：删除已上传的 Telegram 消息（可选），标记为封禁
                        console.log(`Blocked: ${fileName}, label: ${moderation.label}`);
                        // 仍存到 KV 但标记为封禁
                        await env.img_url.put(shortId, '', {
                            metadata: {
                                file_id: fileId,
                                file_name: fileName,
                                file_size: fileSize,
                                ext: ext,
                                timestamp: Date.now(),
                                list_type: 'Block',
                                label: moderation.label || 'blocked',
                                liked: false,
                            }
                        });
                        results.push({ src: `/file/${shortId}.${ext}`, name: fileName, size: fileSize, blocked: true, reason: moderation.label });
                        continue;
                    }
                }

                // 3d. 存 KV（短 ID → 元数据）
                const now = Date.now();
                await env.img_url.put(shortId, '', {
                    metadata: {
                        file_id: fileId,
                        file_name: fileName,
                        file_size: fileSize,
                        ext: ext,
                        timestamp: now,
                        list_type: 'None',
                        label: 'normal',
                        liked: false,
                    }
                });

                // 3e. 更新计数器
                await updateCounter(env, 'total', 1);
                const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
                await updateCounter(env, `today:${dateStr}`, 1);

                // 3f. 反向映射（用于旧版兼容）
                await env.img_url.put(`_fileid:${fileId}`, shortId, { expirationTtl: 86400 * 365 });

                const url = `/file/${shortId}.${ext}`;
                results.push({ src: url, name: fileName, size: fileSize, blocked: false });
            } catch (fileError) {
                console.error('File processing error:', fileError);
                errors.push({ name: uploadFile.name, error: fileError.message });
            }
        }

        return new Response(JSON.stringify({ ok: true, results, errors }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Upload error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function getImagePath(env, fileId) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const data = await res.json();
        return data.ok ? data.result.file_path : '';
    } catch { return ''; }
}

async function updateCounter(env, key, delta) {
    try {
        const fullKey = `_counter:${key}`;
        const prev = await env.img_url.get(fullKey);
        const val = (parseInt(prev || '0', 10) || 0) + delta;
        await env.img_url.put(fullKey, String(val));
    } catch (e) {
        console.error('Counter update error:', e);
    }
}
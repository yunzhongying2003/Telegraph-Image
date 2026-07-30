import { extractKey, isShortId, getFilePath } from "../utils/helpers";

/**
 * GET /file/{id}.{ext} — 获取图片
 *
 * 兼容新旧格式：
 * - 新：/file/abc12345.png → 查 KV 短 ID → 获取 file_id → 从 Telegram 取
 * - 旧：/file/AgACAgE...BA.png → 直接当 file_id 用（backward compat）
 */
export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const key = extractKey(params.id);

    if (!key) {
        return new Response('Invalid file ID', { status: 400 });
    }

    // ── 方案 A：新短 ID 格式 ──
    let fileId = null;
    let metadata = null;

    if (isShortId(key) && env.img_url) {
        const record = await env.img_url.getWithMetadata(key);
        if (record && record.metadata) {
            metadata = record.metadata;
            fileId = metadata.file_id;
        }
    }

    // ── 方案 B：旧长 ID 格式（直接当 file_id 用） ──
    if (!fileId) {
        fileId = key; // 旧格式：key 本身就是 Telegram file_id
        // 尝试从反向映射获取短 ID
        if (env.img_url) {
            const shortId = await env.img_url.get(`_fileid:${fileId}`);
            if (shortId) {
                const record = await env.img_url.getWithMetadata(shortId);
                if (record && record.metadata) {
                    metadata = record.metadata;
                }
            }
        }
    }

    // ── 获取 Telegram 文件路径 ──
    const filePath = await getFilePath(env, fileId);
    if (!filePath) {
        return new Response('File not found', { status: 404 });
    }

    const tgFileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;

    // ── 代理请求 ──
    const response = await fetch(tgFileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // ── 设置正确的 Content-Type ──
    const ext = params.id?.split('.').pop()?.toLowerCase() || '';
    const mimeMap = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml', ico: 'image/x-icon',
        mp4: 'video/mp4', webm: 'video/webm',
        mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    };
    const contentType = mimeMap[ext] || response.headers.get('Content-Type') || 'application/octet-stream';
    const headers = new Headers(response.headers);
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=86400');

    // ── 权限检查（仅当有 metadata 时） ──
    if (metadata && env.img_url) {
        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (metadata.list_type === 'Block' || metadata.label === 'blocked') {
            if (isAdmin) {
                return new Response(response.body, { status: response.status, headers });
            }
            return Response.redirect(`${url.origin}/block-img.html`, 302);
        }
        if (metadata.list_type === 'White') {
            return new Response(response.body, { status: response.status, headers });
        }

        // 白名单模式
        if (env.WhiteList_Mode === 'true' && metadata.list_type !== 'White') {
            return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
        }
    }

    return new Response(response.body, { status: response.status, headers });
}
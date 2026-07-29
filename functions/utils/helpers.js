// ─── 共享工具函数 ───

/**
 * 生成短 ID（8位 base62 随机字符串）
 */
export function generateShortId(length = 8) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    let id = '';
    for (let i = 0; i < length; i++) {
        id += chars[array[i] % chars.length];
    }
    return id;
}

/**
 * 从 params.id 中提取纯 key（去掉扩展名）
 * 兼容新旧格式：新格式是短ID，旧格式是长 file_id
 */
export function extractKey(rawId) {
    if (!rawId) return null;
    const dot = rawId.lastIndexOf('.');
    return dot > 0 ? rawId.substring(0, dot) : rawId;
}

/**
 * 判断是否为短 ID 格式（≤12 字符）
 */
export function isShortId(key) {
    return key && key.length <= 12;
}

/**
 * 通过 Telegram file_id 获取下载路径
 */
export async function getFilePath(env, fileId) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${encodeURIComponent(fileId)}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.ok && data.result) return data.result.file_path;
        return null;
    } catch (e) {
        console.error('getFilePath error:', e.message);
        return null;
    }
}

/**
 * 从 Telegram 响应中提取 file_id
 */
export function getFileIdFromResponse(response) {
    if (!response.ok || !response.result) return null;
    const r = response.result;
    if (r.photo) return r.photo.reduce((p, c) => c.file_size > p.file_size ? c : p).file_id;
    if (r.document) return r.document.file_id;
    if (r.video) return r.video.file_id;
    if (r.audio) return r.audio.file_id;
    return null;
}

/**
 * 上传文件到 Telegram 频道
 */
export async function sendToTelegram(formData, apiEndpoint, env, retryCount = 0) {
    const MAX_RETRIES = 2;
    const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/${apiEndpoint}`;
    try {
        const response = await fetch(apiUrl, { method: 'POST', body: formData });
        const data = await response.json();
        if (response.ok) return { success: true, data };
        if (retryCount < MAX_RETRIES && apiEndpoint === 'sendPhoto') {
            const fd = new FormData();
            fd.append('chat_id', formData.get('chat_id'));
            fd.append('document', formData.get('photo'));
            return await sendToTelegram(fd, 'sendDocument', env, retryCount + 1);
        }
        return { success: false, error: data.description || 'Upload to Telegram failed' };
    } catch (e) {
        console.error('Network error:', e.message);
        if (retryCount < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
            return await sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
        }
        return { success: false, error: 'Network error occurred' };
    }
}

/**
 * 腾讯云图片审核（TC3-HMAC-SHA256 签名）
 * 返回 { pass: true/false, label: '...' }
 * pass=true 表示合规，false 表示违规
 */
export async function moderateImage(env, imageUrl) {
    const secretId = env.TC_SECRET_ID;
    const secretKey = env.TC_SECRET_KEY;
    if (!secretId || !secretKey) {
        return { pass: true, label: 'none' }; // 未配置审核，默认通过
    }

    const service = 'cms';
    const region = env.TC_REGION || 'ap-guangzhou';
    const action = 'ImageModeration';
    const version = '2019-03-21';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');

    const payload = JSON.stringify({ ImageUrl: imageUrl });

    // 1. Canonical Request
    const httpMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const payloadHash = await sha256Hex(payload);
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${service}.tencentcloudapi.com\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = `${httpMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // 2. String to Sign
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

    // 3. Signature
    const secretDate = await hmacSha256(`TC3${secretKey}`, date);
    const secretService = await hmacSha256(secretDate, service);
    const secretSigning = await hmacSha256(secretService, 'tc3_request');
    const signature = await hmacSha256Hex(secretSigning, stringToSign);

    const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    try {
        const res = await fetch(`https://${service}.tencentcloudapi.com`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Host': `${service}.tencentcloudapi.com`,
                'X-TC-Action': action,
                'X-TC-Region': region,
                'X-TC-Timestamp': String(timestamp),
                'X-TC-Version': version,
                'Authorization': authorization,
            },
            body: payload,
        });
        const data = await res.json();
        console.log('Moderation result:', JSON.stringify(data));

        // 解析审核结果
        const suggestion = data?.Response?.Suggestion || '';
        const label = data?.Response?.Label || '';

        // suggestion: 'Pass' = 合规, 'Review' = 需人工, 'Block' = 违规
        if (suggestion === 'Block') {
            return { pass: false, label: label || 'blocked' };
        }
        return { pass: true, label: label || 'normal' };
    } catch (e) {
        console.error('Moderation error:', e.message);
        // 审核失败时默认通过（不阻塞上传）
        return { pass: true, label: 'error' };
    }
}

// ─── 加密工具函数 ───

async function sha256Hex(data) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return bytesToHex(new Uint8Array(hash));
}

async function hmacSha256(key, data) {
    const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacSha256Hex(key, data) {
    const sig = await hmacSha256(key, data);
    return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
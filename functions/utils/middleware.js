/**
 * 通用中间件
 * - errorHandling: 异常捕获
 * - telemetryData: 基础日志
 */

export async function errorHandling(context) {
    try {
        return await context.next();
    } catch (err) {
        console.error('Middleware error:', err.message, err.stack);
        return new Response(`${err.message}\n${err.stack}`, { status: 500 });
    }
}

export function telemetryData(context) {
    const url = new URL(context.request.url);
    console.log(`[${context.request.method}] ${url.pathname}`);
    return context.next();
}
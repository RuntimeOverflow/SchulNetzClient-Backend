export type Response = {
	content: string
	status: number
	headers: { [ key: string ]: string }
}

export function request(url: string, options?: { method?: string, headers?: { [key: string]: string }, body?: string, ignoreStatusCode?: boolean }): Promise<Response>

export class DOMObject {
	static parse(html: string): DOMObject
	
	querySelector(selector: string): DOMObject[]
	innerText(): string
	getAttribute(attribute: string): string
}

export type WaitPromise = Promise<void> & { waitKey: symbol }
export function wait(millis: number): WaitPromise
export function cancelWait(waitKey: symbol): void

export function generateUUID(): string
export function parseDate(str: string, format: string): number | undefined
export function extractQueryParameters(url: string, base?: string): { [key: string]: string } | undefined

export function info(msg: string): void
export function warn(msg: string): void
export function error(msg: string): void
export function fatal(msg: string): void
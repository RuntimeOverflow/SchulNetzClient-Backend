import axios, { Method } from 'axios'
import { JSDOM } from 'jsdom'
import { DateTime } from 'luxon'

export async function request(url: string, options?: { method?: string, headers?: { [key: string]: string }, body?: string, ignoreStatusCode?: boolean }): Promise<Response> {
	const response = await axios({ url: url, method: options?.method as Method, headers: {...options?.headers, 'User-Agent': 'SchulNetz Client Test Environment'}, data: options?.body, maxRedirects: 0, validateStatus: () =>  true })
	
	if(!response) {
		throw `${url}: NO HTTP RESPONSE`
	} else if(!options?.ignoreStatusCode && response.status != 200) {
		throw `${url}: ${response.status}`
	}
	
	let text: string | undefined
	try {
		text = response.data
	} catch(error) {
		throw `${url}: NO DATA`
	}
	
	if(!text) {
		throw `${url}: NO DATA`
	}
	
	return {
		'content': text,
		'status': response.status,
		'headers': Object.entries(response.headers).reduce((map, [key, value]) => {
			map[key] = (typeof value === 'string' ? value : value.join(', '))
			return map
		}, {} as { [key: string]: string })
	}
}

export function extractQueryParameters(url: string, base?: string) {
	const _url = new URL(url, base)
	const params: { [key: string]: string } = {}
	_url.searchParams.forEach((value, key) => params[key] = value)
	return params
}

type WaitPromise = Promise<void> & { waitKey: symbol }

const waitCancelMap: { [Key: symbol]: [ () => void, NodeJS.Timeout ] } = {}

export function wait(millis: number) {
	const waitKey = Symbol()
	
	const promise = new Promise<void>((resolve, reject) => waitCancelMap[waitKey] = [ reject, setTimeout(() => {
		delete waitCancelMap[waitKey]
		resolve()
	}, millis) ]) as WaitPromise
	
	promise.waitKey = waitKey
	
	return promise
}

export function cancelWait(waitKey: symbol) {
	const [ reject, timeout ] = waitCancelMap[waitKey]
	delete waitCancelMap[waitKey]
	clearTimeout(timeout)
	reject()
}

export function info(msg: string) {
	console.info('[INFO] ' + msg)
}

export function warn(msg: string) {
	console.warn('[WARN] ' + msg)
}

export function error(msg: string) {
	console.error('[ERROR] ' + msg)
}

export function fatal(msg: string) {
	console.error('[FATAL] ' + msg)
}

export function parseDate(str: string, format: string): number | undefined {
	const date = DateTime.fromFormat(str, format, { locale: 'ch-de' })
	return date.isValid ? date.toMillis() : undefined
}

let _lastRandomTimestamp = Date.now()
let _randomCounter = 0

export function generateUUID() {
	const timestamp = Date.now()
	let hash
	
	if(timestamp == _lastRandomTimestamp) hash = `${timestamp}${_randomCounter++}`
	else {
		_randomCounter = 0
		hash = `${timestamp}`
	}
	
	_lastRandomTimestamp = timestamp
	return hash
}

export type Response = {
	content: string
	status: number
	headers: { [ key: string ]: string }
}

export class DOMObject {
	private _obj: Element
	
	private constructor(obj: Element) {
		this._obj = obj
	}
	
	public static parse(html: string) {
		const obj = (new JSDOM(html)).window.document.documentElement
		return new DOMObject(obj)
	}
	
	querySelector(selector: string) {
		return Array.from(this._obj?.querySelectorAll(selector)).map(element => new DOMObject(element))
	}
	
	innerText() {
		let text = ''
		
		for(const node of Array.from(this._obj.childNodes)) {
			if(node.nodeType == node.TEXT_NODE) text += node.textContent ?? ''
			else if(node.nodeType == node.ELEMENT_NODE && node.nodeName === 'BR') text += '\n'
		}
		
		return text
	}
	
	getAttribute(attribute: string) {
		return this._obj.getAttribute(attribute) ?? ''
	}
}

export type Absence = {
	id: string
	
	startDate: number
	endDate: number
	reason: string
	additionalInfo?: string
	deadline?: string
	excused: boolean
	lessonCount: number
}

export type AbsenceReport = {
	id: string
	
	absenceId: string
	subjectId?: string
	
	startDate: number
	endDate: number
	lessonAbbreviation: string
	comment: string
}

export type OpenAbsence = {
	id: string
	
	subjectId?: string
	
	startDate: number
	endDate: number
	lessonAbbreviation: string
}

export type LateAbsence = {
	id: string
	
	date: number
	reason: string
	timespan: number
	excused: boolean
}

export type Subject = {
	id: string
	
	teacherId?: string
	
	abbreviation: string
	name?: string
	average: number
	gradesConfirmed: boolean
	hiddenGrades: boolean
}

export type Grade = {
	id: string
	
	subjectId: string
	
	date?: number
	topic: string
	grade?: number
	details?: string
	weight: number
}

export type Student = {
	id: string
	
	lastName: string
	firstName: string
	gender: '♂' | '♀' | '⚧'
	degree: string
	bilingual: boolean
	clazz: string
	address: string
	zip: number
	city: string
	phone?: string
	additionalClass?: string
	status?: string
}

export type Teacher = {
	id : string
	
	lastName: string
	firstName: string
	abbreviation: string
	email: string
}

export type Transaction = {
	id: string
	
	date: number
	reason: string
	amount: number
}
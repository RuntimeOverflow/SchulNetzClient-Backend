import axios, { Method } from 'axios'
import { JSDOM } from 'jsdom'
import { DateTime } from 'luxon'

export async function request(url: string, options?: { method?: string, headers?: { [key: string]: string }, body?: string, ignoreStatusCode?: boolean }) {
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
	
	return new Response(text, response.status, Object.entries(response.headers).reduce((map, [key, value]) => {
		map[key] = (typeof value === 'string' ? value : value.join(', '))
		return map
	}, {} as { [key: string]: string }))
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

export function parseDate(str: string, format: string): Date | undefined {
	const date = DateTime.fromFormat(str, format, { locale: 'ch-de' }).toJSDate()
	return !isNaN(date.getTime()) ? date : undefined
}

export type UniqueId = unknown
type DateRepresentation = unknown

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

export class Response {
	content: string
	status: number
	headers: { [ key: string ]: string }
	
	constructor(content: string, status: number, headers: { [ key: string ]: string }) {
		this.content = content
		this.status = status
		this.headers = headers
	}
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

export interface Identifiable {
	id: UniqueId
}

export type Absence = {
	id: UniqueId
	
	absenceReportIds?: UniqueId[]
	subjectIds?: UniqueId[]
	
	startDate: DateRepresentation
	endDate: DateRepresentation
	reason: string
	additionalInfo?: string
	deadline?: string
	excused: boolean
	lessonCount: number
}

export type AbsenceReport = {
	id: UniqueId
	
	absenceId: UniqueId
	subjectId?: UniqueId
	
	startDate: DateRepresentation
	endDate: DateRepresentation
	lessonAbbreviation: string
	comment: string
}

export type OpenAbsence = {
	id: UniqueId
	
	subjectId?: UniqueId
	
	startDate: DateRepresentation
	endDate: DateRepresentation
	lessonAbbreviation: string
}

export type LateAbsence = {
	id: UniqueId
	
	date: DateRepresentation
	reason: string
	timespan: number
	excused: boolean
}

export type Subject = {
	id: UniqueId
	
	absenceIds?: UniqueId[]
	absenceReportIds?: UniqueId[]
	openAbsenceIds?: UniqueId[]
	gradeIds?: UniqueId[]
	teacherId?: UniqueId
	
	abbreviation: string
	name?: string
	average: number
	gradesConfirmed: boolean
	hiddenGrades: boolean
}

export type Grade = {
	id: UniqueId
	
	subjectId: UniqueId
	
	date?: DateRepresentation
	topic: string
	grade?: number
	details?: string
	weight: number
}

export type Student = {
	id: UniqueId
	
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
	id : UniqueId
	
	subjectIds?: UniqueId[]
	
	lastName: string
	firstName: string
	abbreviation: string
	email: string
}

export type Transaction = {
	id: string
	
	date: DateRepresentation
	reason: string
	amount: number
}
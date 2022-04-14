import axios, { Method } from 'axios'
import { JSDOM } from 'jsdom'
import { DateTime } from "luxon"

export function request(url: string, options?: { method?: string, headers?: { [key: string]: string }, body?: string, ignoreStatusCode?: boolean }) {
	return new Promise<Response>(async (resolve, reject) => {
		try {
			let response = await axios({ url: url, method: options?.method as Method, headers: {...options?.headers, 'User-Agent': 'SchulNetz Client Test Environment'}, data: options?.body, maxRedirects: 0, validateStatus: () =>  true })
			
			if(!response) {
				reject(`${url}: NO HTTP RESPONSE`)
				return
			} else if(!options?.ignoreStatusCode && response.status != 200) {
				reject(`${url}: ${response.status}`)
				return
			}
			
			let text: string | undefined
			try {
				text = response.data
			} catch(error) {
				reject(`${url}: NO DATA`)
				return
			}
			
			if(!text) {
				reject(`${url}: NO DATA`)
				return
			}
			
			resolve(new Response(text, response.status, Object.entries(response.headers).reduce((map, [key, value]) => {
				map[key] = (typeof value === 'string' ? value : value.join(', '))
				return map
			}, {} as { [key: string]: string })))
		} catch(error) {
			reject(`${error}`)
		}
	})
}

export function extractQueryParameters(url: string, base?: string) {
	let _url = new URL(url, base)
	let params: { [key: string]: string } = {}
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
	let [ reject, timeout ] = waitCancelMap[waitKey]
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

export type UniqueId = any
type DateRepresentation = any

let _lastRandomTimestamp = Date.now()
let _randomCounter = 0

export function generateUUID() {
	let timestamp = Date.now()
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
		let text = '';
		
		for(let node of Array.from(this._obj.childNodes)) {
			if(node.nodeType == node.TEXT_NODE) text += node.textContent ?? ''
			else if(node.nodeType == node.ELEMENT_NODE && node.nodeName === 'BR') text += '\n'
		}
		
		return text
	}
	
	getAttribute(attribute: string) {
		return this._obj.getAttribute(attribute) ?? ''
	}
}

export type Objectify<T> = { [Key in keyof T as T[Key] extends Function ? never : Key]: T[Key] }

export interface Identifiable {
	id: UniqueId
}

interface Linkable {
	link: () => void
}

interface Base extends Identifiable, Linkable {}

export type AbsenceObj = Objectify<Absence>

export class Absence implements Base {
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
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, startDate, endDate, reason, additionalInfo, deadline, excused, lessonCount }: AbsenceObj) {
		this.id = id
		
		this.startDate = startDate
		this.endDate = endDate
		this.reason = reason
		this.additionalInfo = additionalInfo
		this.deadline = deadline
		this.excused = excused
		this.lessonCount = lessonCount
	}
}

export type AbsenceReportObj = Objectify<AbsenceReport>

export class AbsenceReport implements Base {
	id: UniqueId
	
	absenceId: UniqueId
	subjectId?: UniqueId
	
	startDate: DateRepresentation
	endDate: DateRepresentation
	lessonAbbreviation: string
	comment: string
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, absenceId, startDate, endDate, lessonAbbreviation, comment }: AbsenceReportObj) {
		this.id = id
		
		this.absenceId = absenceId
		
		this.startDate = startDate
		this.endDate = endDate
		this.lessonAbbreviation = lessonAbbreviation
		this.comment = comment
	}
}

export type OpenAbsenceObj = Objectify<OpenAbsence>

export class OpenAbsence implements Base {
	id: UniqueId
	
	subjectId?: UniqueId
	
	startDate: DateRepresentation
	endDate: DateRepresentation
	lessonAbbreviation: string
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, startDate, endDate, lessonAbbreviation }: OpenAbsenceObj) {
		this.id = id
		
		this.startDate = startDate
		this.endDate = endDate
		this.lessonAbbreviation = lessonAbbreviation
	}
}

export type LateAbsenceObj = Objectify<LateAbsence>

export class LateAbsence implements Base {
	id: UniqueId
	
	date: DateRepresentation
	reason: string
	timespan: number
	excused: boolean
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, date, reason, timespan, excused }: LateAbsenceObj) {
		this.id = id
		
		this.date = date
		this.reason = reason
		this.timespan = timespan
		this.excused = excused
	}
}

export type SubjectObj = Objectify<Subject>

export class Subject implements Base {
	id: UniqueId
	
	absenceIds?: UniqueId[]
	absenceReportIds?: UniqueId[]
	openAbsenceIds?: UniqueId[]
	gradeIds?: UniqueId[]
	teacherId?: UniqueId
	
	abbreviation: string
	name?: string
	gradesConfirmed: boolean
	hiddenGrades: boolean
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, abbreviation, name, gradesConfirmed, hiddenGrades }: SubjectObj) {
		this.id = id
		
		this.abbreviation = abbreviation
		this.name = name
		this.gradesConfirmed = gradesConfirmed
		this.hiddenGrades = hiddenGrades
	}
}

export type GradeObj = Objectify<Grade>

export class Grade implements Base {
	id: UniqueId
	
	subjectId: UniqueId
	
	date?: DateRepresentation
	topic: string
	grade?: number
	details?: string
	weight: number
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, subjectId, date, topic, grade, details, weight }: GradeObj) {
		this.id = id
		
		this.subjectId = subjectId
		
		this.date = date
		this.topic = topic
		this.grade = grade
		this.details = details
		this.weight = weight
	}
}

export type StudentObj = Objectify<Student>

export class Student implements Base {
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
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, lastName, firstName, gender, degree, bilingual, clazz, address, zip, city, phone, additionalClass, status }: StudentObj) {
		this.id = id
		
		this.lastName = lastName
		this.firstName = firstName
		this.gender = gender
		this.degree = degree
		this.bilingual = bilingual
		this.clazz = clazz
		this.address = address
		this.zip = zip
		this.city = city
		this.phone = phone
		this.additionalClass = additionalClass
		this.status = status
	}
}

export type TeacherObj = Objectify<Teacher>

export class Teacher implements Base {
	id : UniqueId
	
	subjectIds?: UniqueId[]
	
	lastName: string
	firstName: string
	abbreviation: string
	email: string
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, lastName, firstName, abbreviation, email }: TeacherObj) {
		this.id = id
		
		this.lastName = lastName
		this.firstName = firstName
		this.abbreviation = abbreviation
		this.email = email
	}
}

export type TransactionObj = Objectify<Transaction>

export class Transaction implements Base {
	id: string
	
	date: DateRepresentation
	reason: string
	amount: number
	
	static create = (obj: Objectify<InstanceType<typeof this>>) => new this(obj)
	link = () => {}
	
	constructor({ id, date, reason, amount }: TransactionObj) {
		this.id = id
		
		this.date = date
		this.reason = reason
		this.amount = amount
	}
}
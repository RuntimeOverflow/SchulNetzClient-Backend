import { Absence, AbsenceReport, cancelWait, DOMObject, error, extractQueryParameters, fatal, generateUUID, Grade, info, LateAbsence, OpenAbsence, parseDate, request, Response, Student, Subject, Teacher, Transaction, UniqueId, wait, warn } from './env.js'

// TODO: Error recovery especially for parsers
// TODO: tscc?

/************\
| Exceptions |
\************/

enum ExceptionLevel {
	Info,
	Warn,
	Error,
	Fatal,
}

class Exception {
	protected type = 'Exception'
	
	private func: string
	public message: string
	
	public level?: ExceptionLevel
	
	constructor(func: string, message: string) {
		this.func = func
		this.message = message
	}
}

class ParserException extends Exception {
	protected type = 'ParserException'
}

class LinkerException extends Exception {
	protected type = 'LinkerException'
}

/*class NetworkException extends Exception {
	protected type = 'NetworkException'
	
	private url: string
	
	constructor(func: string, url: string, message: string) {
		super(func, message)
		
		this.url = url
	}
}

class SchulNetzException extends Exception {
	protected type = 'SchulNetzException'
	
	private errorCode: number
	
	constructor(func: string, errorCode: number, message: string) {
		super(func, message)
		
		this.errorCode = errorCode
	}
}*/

class JavaScriptException extends Exception {
	protected type = 'JavaScriptException'
}

/*******************\
| Utility Functions |
\*******************/

function assert(condition: boolean, exception: Exception) {
	if(!condition) throw exception
}

function assertInfo(condition: boolean, exception: Exception) {
	if(!condition) info(exception.message)
}

function assertWarn(condition: boolean, exception: Exception) {
	if(!condition) {
		exception.level = ExceptionLevel.Warn
		warn(exception.message)
		throw exception
	}
}

function assertError(condition: boolean, exception: Exception) {
	if(!condition) {
		exception.level = ExceptionLevel.Error
		error(exception.message)
		throw exception
	}
}

function assertFatal(condition: boolean, exception: Exception) {
	if(!condition) {
		exception.level = ExceptionLevel.Fatal
		fatal(exception.message)
		throw exception
	}
}

/***********\
| Constants |
\***********/

enum Page {
	ABSENCES = 21111,
	TEACHERS = 22352,
	STUDENTS = 22348,
	TRANSACTIONS = 21411,
	GRADES = 21311,
	SCHEDULE = 22202,
	DOCUMENT_DOWNLOAD = 1012,
}

class User {
	teachers: Teacher[] = []
	students: Student[] = []
	transactions: Transaction[] = []
	absences: Absence[] = []
	absenceReports: AbsenceReport[] = []
	openAbsences: OpenAbsence[] = []
	lateAbsences: LateAbsence[] = []
	subjects: Subject[] = []
	grades: Grade[] = []
}

/*********\
| Session |
\*********/

class Session {
	/**************\
	| Account Data |
	\**************/
	
	private provider: string
	private username: string
	private password: string
	
	public constructor(provider: string, username: string, password: string) {
		this.provider = provider
		this.username = username
		this.password = password
	}
	
	/**************\
	| Session Data |
	\**************/
	
	private id?: string
	private transId?: string
	private lastVisitedPageId?: number
	private visitedPageIds = new Set<Page>()
	
	private verifyPageAndExtractIds(dom: DOMObject) {
		const links = dom.querySelector('#header-menu ul[for=sn-main-menu] > li:nth-child(1) > a')
		assert(links.length == 1, new ParserException('verifyPageAndExtractIds', 'dom.querySelector(\'#header-menu ul[for=sn-main-menu] > li:nth-child(1) > a\').length != 1'))
		
		const { id, transid } = extractQueryParameters(links[0].getAttribute('href'), 'https://' + this.provider)
		assert(!!id, new ParserException('verifyPageAndExtractIds', `id == null || id == '' (was ${id != undefined ? '\'\'' : undefined})`))
		assert(!!transid, new ParserException('verifyPageAndExtractIds', `transid == null || transid == '' (was ${transid != undefined ? '\'\'' : undefined})`))
		this.id = id as string
		this.transId = transid as string
	}
	
	public hasVisitedPage(page: Page) {
		return this.visitedPageIds.has(page)
	}
	
	/****************\
	| Session States |
	\****************/
	
	private _loggedIn = false
	public set loggedIn(value: boolean) { this._loggedIn = value }
	public get loggedIn() { return !!(this._loggedIn && this.id && this.transId && this.lastVisitedPageId != null) }
	
	private stateLockQueue: [(() => void), (() => void)][] = []
	private _stateLock?: symbol
	private get stateLock() { return this._stateLock }
	private set stateLock(value: symbol | undefined) {
		this._stateLock = value
		
		if(!value) {
			const next = this.stateLockQueue.pop()
			if(next) next[0]()
			else this.stateChanging = false
		} else this.stateChanging = true
	}
	
	private _stableStateRetainCount = 0
	private get stableStateRetainCount() { return this._stableStateRetainCount }
	private set stableStateRetainCount(value: number) {
		if(this.stableStateRetainCount == 0 && value > this.stableStateRetainCount) this.stateLock = Symbol()
		else if(value == 0 && value < this.stableStateRetainCount) this.stateLock = undefined
		
		this.stateChanging = false
		
		this._stableStateRetainCount = value
	}
	
	private stableStateListeners: [(() => void), (() => void)][] = []
	private _stateChanging = false
	private get stateChanging() { return this._stateChanging }
	private set stateChanging(value: boolean) {
		this._stateChanging = value
		
		if(!value) {
			this.stableStateListeners.forEach(listener => listener[0]())
			this.stableStateListeners = []
		}
	}
	
	private teardownLockInfrastructure() {
		this.stableStateListeners.forEach(([ , cancel]) => cancel())
		this.stableStateListeners = []
		this.stateLockQueue.forEach(([ , cancel]) => cancel())
		this.stateLockQueue = []
		
		this.stateLock = undefined
		this.stableStateRetainCount = 0
		this.stateChanging = false
	}
	
	public async acquireStateLock() {
		try {
			if(this.stateLock) await new Promise<void>((resolve, reject) => this.stateLockQueue.push([resolve, reject]))
		} catch(e) {
			return undefined
		}
		
		const sym = Symbol()
		this.stateLock = sym
		return sym
	}
	
	public async acquireStateLockWithPriority() {
		try {
			if(this.stateLock) await new Promise<void>((resolve, reject) => this.stateLockQueue.unshift([resolve, reject]))
		} catch(e) {
			return undefined
		}
		
		const sym = Symbol()
		this.stateLock = sym
		return sym
	}
	
	private async forcefullyAcquireStateLock() {
		this.stableStateListeners.forEach(([ , cancel]) => cancel())
		this.stableStateListeners = []
		this.stateLockQueue.forEach(([ , cancel]) => cancel())
		this.stateLockQueue = []
		
		try {
			if(this.stateLock) await new Promise<void>((resolve, reject) => this.stateLockQueue.push([resolve, reject]))
		} catch(e) {
			return undefined
		}
		
		const sym = Symbol()
		this.stateLock = sym
		return sym
	}
	
	public releaseStateLock(key: symbol) {
		if(key === this.stateLock) this.stateLock = undefined
	}
	
	public async retainStableState() {
		try {
			if(this.stateChanging) await new Promise<void>((resolve, reject) => this.stableStateListeners.push([resolve, reject]))
		} catch(e) {
			return false
		}
		
		this.stableStateRetainCount++
		
		return true
	}
	
	public releaseStableState() {
		this.stableStateRetainCount--
	}
	
	/*****************\
	| Cookie Handling |
	\*****************/
	
	private cookies: { [key: string]: string } = {}
	
	private get cookieString() {
		return Object.entries(this.cookies).map(([ key, value ]) => key + '=' + value).join('; ')
	}
	
	private updateCookies(resp: Response) {
		let rawHeaders = resp.headers['set-cookie']
		assert(!!rawHeaders, new ParserException('updateCookies', `!!rawHeaders (was ${undefined})`))
		
		let key: string | undefined = undefined
		let metadata = false
		
		let match
		while(match = /(^.*?)([;=,])/.exec(rawHeaders)) {
			if(match && match.length == 3) {
				rawHeaders = rawHeaders.substring(match[0].length).trim()
				
				if(key == undefined) {
					key = match[1]
					
					if(match[2] !== '=') continue
				} else {
					if(match[2] !== '=' && !metadata) {
						this.cookies[(key as string).trim()] = match[1].trim()
					}
					
					key = undefined
					
					if(match[2] === ',') {
						metadata = false
						continue
					}
					
					metadata = true
				}
			}
		}
	}
	
	/******************\
	| Timeout Handling |
	\******************/
	
	private sessionTimerRunning = false
	private waitKey?: symbol
	
	private async resetTimeout() {
		if(!this.loggedIn) return false
		
		try {
			const response = await request(`https://${this.provider}/xajax_js.php?pageid=${this.lastVisitedPageId}&id=${this.id}&transid=${this.transId}`, { method: 'POST', body: 'xajax=reset_timeout', headers: { 'Cookie': this.cookieString } })
			
			this.updateCookies(response)
		} catch(e) {
			this.handleLogout()
			
			return false
		}
		
		return true
	}
	
	private async sessionTimer() {
		if(this.sessionTimerRunning) return
		
		this.sessionTimerRunning = true
		
		try {
			do {
				const promise = wait(25 * 60 * 1000)
				this.waitKey = promise.waitKey
				await promise
			} while(await this.resetTimeout())
		} catch(e) {}
		
		this.sessionTimerRunning = false
	}
	
	private stopSessionTimer() {
		if(this.waitKey) cancelWait(this.waitKey)
		this.waitKey = undefined
	}
	
	/*******************\
	| Session Lifecycle |
	\*******************/
	
	public async login() {
		if(this.loggedIn) return
		
		let stateLock: symbol | undefined = await this.acquireStateLockWithPriority()
		assert(!!stateLock, new Exception('login', 'Failed to acquire state lock'))
		stateLock = stateLock as symbol
		
		try {
			if(this.loggedIn) {
				this.releaseStateLock(stateLock)
				return
			}
			
			// TODO: Error handling
			let html = await request(`https://${this.provider}/loginto.php`)
			this.updateCookies(html)
			
			// TODO: Error handling
			const dom = DOMObject.parse(html.content)
			
			const loginHashInputs = dom.querySelector('#standardformular input[type=hidden][name=loginhash]')
			assert(loginHashInputs.length == 1, new ParserException('login', `dom.querySelector('#standardformular input[type=hidden][name=loginhash]').length != 1 (was ${loginHashInputs.length})`))
			
			const loginHash = loginHashInputs[0].getAttribute('value')
			assert(!!loginHash, new ParserException('login', `loginHash == null || loginHash == '' ${loginHash != undefined ? '\'\'' : undefined}`))
			
			// TODO: Error handling
			html = await request(`https://${this.provider}/index.php`, { method: 'POST', body: `login=${encodeURIComponent(this.username)}&passwort=${encodeURIComponent(this.password)}&loginhash=${encodeURIComponent(loginHash)}`, headers: { 'Cookie': this.cookieString }, ignoreStatusCode: true })
			this.updateCookies(html)
			
			// TODO: Error handling
			this.verifyPageAndExtractIds(DOMObject.parse(html.content))
			
			this.loggedIn = true
			this.lastVisitedPageId = 1
			this.sessionTimer()
		} catch(e) {
			this.handleLogout()
			
			throw e
		} finally{
			this.releaseStateLock(stateLock)
		}
	}
	
	public async logout() {
		if(!this.loggedIn) {
			this.handleLogout()
			return
		}
		
		const stateLock = await this.forcefullyAcquireStateLock()
		if(!stateLock) {
			this.teardownLockInfrastructure()
			this.handleLogout()
			return
		}
		
		try {
			// TODO: Error handling
			await request(`https://${this.provider}/index.php?pageid=9999&id=${this.id}&transid=${this.transId}`, { method: 'GET', headers: { 'Cookie': this.cookieString }, ignoreStatusCode: true })
		} finally{
			this.handleLogout()
			this.releaseStateLock(stateLock)
		}
	}
	
	private handleLogout() {
		this.id = undefined
		this.transId = undefined
		this.lastVisitedPageId = undefined
		this.visitedPageIds.clear()
		
		this.cookies = {}
		
		this.loggedIn = false
		
		this.stopSessionTimer()
	}
	
	/****************\
	| Fetching Pages |
	\****************/
	
	public async fetchPage(pageId: Page, changesState = true, additionalQueryParameters: { [key: string]: string | number } = {}) {
		assert(this.loggedIn, new Exception('fetchPage', 'Not logged in'))
		
		let stateLock: symbol | undefined
		
		if(changesState) {
			stateLock = await this.acquireStateLock()
			assert(!!stateLock, new Exception('fetchPage', 'Failed to acquire state lock'))
		} else {
			const success = await this.retainStableState()
			assert(success, new Exception('fetchPage', 'Failed to retain stable state'))
		}
		
		let html: string
		
		try {
			// TODO: Error handling
			const response = await request(`https://${this.provider}/index.php?pageid=${pageId}&id=${this.id}&transid=${this.transId}${Object.entries(additionalQueryParameters).map(([ key, value ]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('')}`, { method: 'GET', headers: { 'Cookie': this.cookieString } })
			
			html = response.content
			
			if(changesState) this.verifyPageAndExtractIds(DOMObject.parse(html))
			
			this.visitedPageIds.add(pageId)
		} catch(e) {
			this.handleLogout()
			
			throw e
		} finally{
			if(changesState) {
				if(stateLock) this.releaseStateLock(stateLock)
			} else {
				this.releaseStableState()
			}
		}
		
		return html
	}
}

/****************\
| Parser Results |
\****************/

class ParserResult {
	exceptions: Exception[] = []
}

class TeachersParserResult extends ParserResult {
	teachers: Teacher[] = []
}

class StudentsParserResult extends ParserResult {
	students: Student[] = []
}

class TransactionsParserResult extends ParserResult {
	transactions: Transaction[] = []
}

class AbsencesParserResult extends ParserResult {
	absences: Absence[] = []
	absenceReports: AbsenceReport[] = []
	openAbsences: OpenAbsence[] = []
	lateAbsences: LateAbsence[] = []
}

class GradesParserResult extends ParserResult {
	subjects: Subject[] = []
	grades: Grade[] = []
}

/*********\
| Parsers |
\*********/

const Parser = (globalThis as { Parser?: unknown })['Parser'] = {
	parseTeachers(content: string): TeachersParserResult {
		const result = new TeachersParserResult()
		
		try {
			assertError(!!content, new ParserException('parseTeachers', `!!content (was ${content != undefined ? '\'\'' : undefined})`))
			
			const lines = content.trim().replace(/[\r\n]+/g, '\n').split('\n')
			
			assertFatal(lines.length >= 1, new ParserException('parseTeachers', `lines.length >= 1 (was ${lines.length})`))
			
			lines.shift()
			
			let line: string | undefined
			while((line = lines.shift()) != undefined) {
				try {
					line = line.trim()
				
					const matches = Array.from(line.matchAll(/"(([^"]|"")*)"/g))
				
					assertFatal(matches.length == 4, new ParserException('parseTeachers', `matches.length == 4 (was ${matches.length})`))
					for(let i = 0; i < matches.length; i++) {
						assertFatal(!!matches[i], new ParserException('parseTeachers', `!!matches[${i}] (was ${undefined})`))
						assertFatal(matches[i].length >= 2, new ParserException('parseTeachers', `matches[${i}].length >= 2 (was ${matches[i].length})`))
						assertFatal(typeof matches[i][1] === 'string', new ParserException('parseTeachers', `typeof matches[${i}][1] === 'string' (was ${typeof matches[i][1]})`))
					}
				
					const teacher: Partial<Teacher> = {}
				
					teacher.id = generateUUID()
				
					teacher.lastName = matches[0][1].trim().replace(/""/g, '"')
					teacher.firstName = matches[1][1].trim().replace(/""/g, '"')
					teacher.abbreviation = matches[2][1].trim().replace(/""/g, '"')
					teacher.email = matches[3][1].trim().replace(/""/g, '"')
				
					result.teachers.push(teacher as Teacher)
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseTeachers', `${exception}`))
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('parseTeachers', `${exception}`))
		}
		
		return result
	},
	
	parseStudents(content: string): StudentsParserResult {
		const result = new StudentsParserResult()
		
		try {
			assertError(!!content, new ParserException('parseStudents', `!!content (was ${content != undefined ? '\'\'' : undefined})`))
		
			const lines = content.trim().replace(/[\r\n]+/g, '\n').split('\n')
		
			assertError(!!lines, new ParserException('parseStudents', `!!lines (was ${lines})`))
			assertFatal(lines.length > 0, new ParserException('parseStudents', `lines.length > 0 (was ${lines.length})`))
		
			lines.shift()
		
			let line: string | undefined
			while((line = lines.shift()) != undefined) {
				try {
					line = line.trim()
			
					const matches = Array.from(line.matchAll(/"(([^"]|"")*)"/g))
			
					assertFatal(matches.length == 12, new ParserException('parseStudents', `matches.length == 12 (was ${matches.length})`))
					for(let i = 0; i < matches.length; i++) {
						assertFatal(!!matches[i], new ParserException('parseStudents', `!!matches[${i}] (was ${undefined})`))
						assertFatal(matches[i].length >= 2, new ParserException('parseStudents', `matches[${i}].length >= 2 (was ${matches[i].length})`))
						assertFatal(typeof matches[i][1] === 'string', new ParserException('parseStudents', `typeof matches[${i}][1] === 'string' (was ${typeof matches[i][1]})`))
					}
			
					const student: Partial<Student> = {}
			
					student.id = generateUUID()
			
					student.lastName = matches[0][1].trim().replace(/""/g, '"')
					student.firstName = matches[1][1].trim().replace(/""/g, '"')
			
					switch(matches[2][1].trim().replace(/""/g, '"')) {
						case 'm':
							student.gender = '♂'
							break
						case 'w':
							student.gender = '♀'
							break
						default:
							student.gender = '⚧'
							break
					}
			
					student.degree = matches[3][1].trim().replace(/""/g, '"')
					student.bilingual = matches[4][1].trim().replace(/""/g, '"') === 'b'
					student.clazz = matches[5][1].trim().replace(/""/g, '"')
					student.address = matches[6][1].trim().replace(/""/g, '"')
			
					student.zip = parseInt(matches[7][1].trim().replace(/""/g, '"'))
					assertError(!isNaN(student.zip), new ParserException('parseStudents', `!isNaN(student.zip) (was ${NaN})`))
			
					student.city = matches[8][1].trim().replace(/""/g, '"')
					student.phone = matches[9][1].trim().replace(/""/g, '"')
					student.additionalClass = matches[10][1].trim().replace(/""/g, '"')
					student.status = matches[11][1].trim().replace(/""/g, '"')
			
					result.students.push(student as Student)
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseStudents', `${exception}`))
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('parseStudents', `${exception}`))
		}
		
		return result
	},
	
	parseTransactions(content: string): TransactionsParserResult {
		const result = new TransactionsParserResult()
		
		try {
			assertError(!!content, new ParserException('parseTransaction', `!!content (was ${content != undefined ? '\'\'' : undefined})`))
		
			let dom: DOMObject | undefined
		
			// TODO: Error handling
			dom = DOMObject.parse(content)
		
			assertError(!!dom, new ParserException('parseTransactions', `!!dom (was ${undefined})`))
		
			dom = dom as DOMObject
		
			const tables = dom.querySelector('#content-card > table')
		
			assertFatal(!!tables, new ParserException('parseTransactions', `!!tables (was ${undefined})`))
			assertFatal(tables.length == 2, new ParserException('parseTransactions', `tables.length == 2 (was ${tables.length})`))
			assertFatal(!!tables[1], new ParserException('parseTransactions', `!!tables[1] (was ${undefined})`))
		
			const table = tables[1]
		
			const rows = table.querySelector('tr')
		
			assertFatal(!!rows, new ParserException('parseTransactions', `!!rows (was ${undefined})`))
			assertFatal(rows.length >= 2, new ParserException('parseTransactions', `rows.length >= 2 (was ${rows.length})`))
		
			rows.shift()
			rows.pop()
		
			for(let i = 0; i < rows.length; i++) {
				if(!rows[i]) {
					rows.splice(i, 1)
					i--
				}
			}
		
			for(const row of rows) {
				try {
					const fields = row.querySelector('td')
			
					assertFatal(!!fields, new ParserException('parseTransactions', `!!fields (was ${undefined})`))
					assertFatal(fields.length == 4, new ParserException('parseTransactions', `fields.length == 4 (was ${fields.length})`))
					for(let i = 0; i < fields.length; i++) assertFatal(!!fields[i], new ParserException('parseTransactions', `!!fields[${i}] (was ${undefined})`))
			
					const transaction: Partial<Transaction> = {}
			
					transaction.id = generateUUID()
			
					const dateHTML = fields[0].innerText()?.trim()
					assertFatal(!!dateHTML, new ParserException('parseTransactions', `!!dateHTML (was ${dateHTML != undefined ? '\'\'' : undefined})`))
					transaction.date = parseDate(dateHTML, 'dd.MM.yyyy')
			
					transaction.reason = fields[1].innerText()?.trim()
					assertFatal(!!transaction.reason, new ParserException('parseTransactions', `!!transaction.reason (was ${transaction.reason != undefined ? '\'\'' : undefined})`))
			
					const amountElement = fields[2].querySelector('span')
					assertFatal(!!amountElement, new ParserException('parseTransactions', `!!amountElement (was ${undefined})`))
					assertFatal(amountElement.length == 1, new ParserException('parseTransactions', `amountElement.length == 4 (was ${amountElement.length})`))
					assertFatal(!!amountElement[0], new ParserException('parseTransactions', `!!amountElement[0] (was ${undefined})`))
			
					const amountHTML = amountElement[0].innerText()?.trim()
					assertFatal(!!amountHTML, new ParserException('parseTransactions', `!!amountHTML (was ${amountHTML != undefined ? '\'\'' : undefined})`))
					transaction.amount = parseFloat(amountHTML)
					assertFatal(!isNaN(transaction.amount), new ParserException('parseTransactions', `!isNaN(transaction.amount) (was ${NaN})`))
			
					result.transactions.push(transaction as Transaction)
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseTransactions', `${exception}`))
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('parseTransactions', `${exception}`))
		}
		
		return result
	},
	
	parseAbsences(content: string): AbsencesParserResult {
		const result = new AbsencesParserResult()
		
		try {
			assertError(!!content, new ParserException('parseAbsences', `!!content (was ${content != undefined ? '\'\'' : undefined})`))
		
			let dom: DOMObject | undefined
		
			// TODO: Error handling
			dom = DOMObject.parse(content)
		
			assertError(!!dom, new ParserException('parseAbsences', `!!dom (was ${undefined})`))
		
			dom = dom as DOMObject
		
			const tables = dom.querySelector('#uebersicht_bloecke > page > div > table')
		
			assertFatal(!!tables, new ParserException('parseAbsences', `!!tables (was ${undefined})`))
			assertFatal(tables.length == 1 || tables.length == 2, new ParserException('parseAbsences', `tables.length == 1 || tables.length == 2 (was ${tables.length})`))
			for(let i = 0; i < tables.length; i++) assertFatal(!!tables[i], new ParserException('parseAbsences', `!!tables[${i}] (was ${undefined})`))
		
			const absenceRows = tables[0].querySelector('table.mdl-data-table > tbody > tr')
		
			assertFatal(!!absenceRows, new ParserException('parseAbsences', `!!absenceRows (was ${undefined})`))
		
			if(absenceRows.length > 0 && absenceRows[absenceRows.length - 1].querySelector('button').length > 0) absenceRows.pop()
		
			assertFatal(absenceRows.length >= 3, new ParserException('parseAbsences', `absenceRows.length >= 3 (was ${absenceRows.length})`))
			assertFatal((absenceRows.length - 3) % 2 == 0, new ParserException('parseAbsences', `(absenceRows.length - 3) % 2 == 0 (was ${absenceRows.length})`))
		
			absenceRows.shift()
			absenceRows.pop()
			absenceRows.pop()
		
			for(let i = 0; i < absenceRows.length; i++) {
				if(!absenceRows[i]) {
					absenceRows.splice(i, 1)
					i--
				}
			}
		
			for(let absenceRowIndex = 0; absenceRowIndex < absenceRows.length; absenceRowIndex++) {
				try {
					const absenceRow = absenceRows[absenceRowIndex]
					const absenceFields = absenceRow.querySelector('td')
			
					assertFatal(!!absenceFields, new ParserException('parseAbsences', `!!absenceFields (was ${undefined})`))
					assertFatal(absenceFields.length == 7, new ParserException('parseAbsences', `absenceFields.length == 7 (was ${absenceFields.length})`))
					for(let i = 0; i < absenceFields.length; i++) assertFatal(!!absenceFields[i], new ParserException('parseAbsences', `!!absenceFields[${i}] (was ${undefined})`))
			
					const absence: Partial<Absence> = {}
			
					absence.id = generateUUID()
			
					const absenceFromDateHTML = absenceFields[0].innerText()?.trim()
					assertFatal(!!absenceFromDateHTML, new ParserException('parseAbsences', `!!absenceFromDateHTML (was ${absenceFromDateHTML != undefined ? '\'\'' : undefined})`))
					const absenceToDateHTML = absenceFields[1].innerText()?.trim()
					assertFatal(!!absenceToDateHTML, new ParserException('parseAbsences', `!!absenceToDateHTML (was ${absenceToDateHTML != undefined ? '\'\'' : undefined})`))
			
					absence.startDate = parseDate(absenceFromDateHTML, 'dd.MM.yyyy')
					assertFatal(!!absence.startDate, new ParserException('parseAbsences', `!!absence.startDate (was ${undefined})`))
					absence.endDate = parseDate(absenceToDateHTML, 'dd.MM.yyyy')
					assertFatal(!!absence.endDate, new ParserException('parseAbsences', `!!absence.endDate (was ${undefined})`))
			
					absence.reason = absenceFields[2].innerText()?.trim()
					assertFatal(absence.reason != undefined, new ParserException('parseAbsences', `absence.reason (was ${undefined})`))
			
					absence.additionalInfo = absenceFields[3].innerText()?.trim()
					assertFatal(absence.additionalInfo != undefined, new ParserException('parseAbsences', `absence.additionalInfo (was ${undefined})`))
			
					absence.deadline = absenceFields[4].innerText()?.trim()
					assertFatal(absence.deadline != undefined, new ParserException('parseAbsences', `absence.deadline (was ${undefined})`))
			
					const excused = absenceFields[5].innerText()?.trim()
					assertFatal(excused != undefined, new ParserException('parseAbsences', `excused (was ${undefined})`))
					absence.excused = excused === 'Ja'
			
					const lessonCount = absenceFields[6].innerText()?.trim()
					assertFatal(lessonCount != undefined, new ParserException('parseAbsences', `lessonCount (was ${undefined})`))
					absence.lessonCount = parseInt(lessonCount)
					assertFatal(!isNaN(absence.lessonCount), new ParserException('parseAbsences', `!isNaN(absence.lessonCount) (was ${NaN})`))
			
					result.absences.push(absence as Absence)
			
					let reportsTable: DOMObject
					if(absenceRowIndex + 1 < absenceRows.length && ([ reportsTable ] = absenceRows[absenceRowIndex + 1].querySelector('tr table')) && reportsTable) {
						absenceRowIndex++
				
						const absenceReportRows = reportsTable.querySelector('tr')
				
						assertFatal(!!absenceReportRows, new ParserException('parseAbsences', `!!absenceReportRows (was ${undefined})`))
						assertFatal(absenceReportRows.length >= 2, new ParserException('parseAbsences', `absenceReportRows.length >= 2 (was ${absenceReportRows.length})`))
						for(let i = 0; i < absenceReportRows.length; i++) assertFatal(!!absenceReportRows[i], new ParserException('parseAbsences', `!!absenceReportRows[${i}] (was ${undefined})`))
				
						absenceReportRows.shift()
						absenceReportRows.shift()
				
						for(let absenceReportRowIndex = 0; absenceReportRowIndex < absenceReportRows.length; absenceReportRowIndex++) {
							try {
								const absenceReportRow = absenceReportRows[absenceReportRowIndex]
								const absenceReportFields = absenceReportRow.querySelector('td')
					
								assertFatal(!!absenceReportFields, new ParserException('parseAbsences', `!!absenceReportFields (was ${undefined})`))
								assertFatal(absenceReportFields.length == 4, new ParserException('parseAbsences', `absenceReportFields.length == 7 (was ${absenceReportFields.length})`))
								for(let i = 0; i < absenceReportFields.length; i++) assertFatal(!!absenceReportFields[i], new ParserException('parseAbsences', `!!absenceReportFields[${i}] (was ${undefined})`))
					
								const absenceReport: Partial<AbsenceReport> = {}
					
								absenceReport.id = generateUUID()
					
								absenceReport.absenceId = absence.id
					
								const absenceReportDateHTML = absenceReportFields[0].innerText()?.trim()
								assertFatal(!!absenceReportDateHTML, new ParserException('parseAbsences', `!!absenceReportDateHTML (was ${absenceReportDateHTML != undefined ? '\'\'' : undefined})`))
					
								const absenceReportTimeHTML = absenceReportFields[1].innerText()?.trim()
								assertFatal(!!absenceReportTimeHTML, new ParserException('parseAbsences', `!!absenceReportTimeHTML (was ${absenceReportTimeHTML != undefined ? '\'\'' : undefined})`))
								const [ absenceReportStartTime, absenceReportEndTime ] = absenceReportTimeHTML.split('bis').map(str => str.trim())
								assertFatal(!!absenceReportStartTime, new ParserException('parseAbsences', `!!absenceReportStartTime (was ${absenceReportStartTime != undefined ? '\'\'' : undefined})`))
								assertFatal(!!absenceReportEndTime, new ParserException('parseAbsences', `!!absenceReportEndTime (was ${absenceReportEndTime != undefined ? '\'\'' : undefined})`))
					
								absenceReport.startDate = parseDate(`${absenceReportDateHTML} ${absenceReportStartTime}`, 'dd.MM.yyyy HH:mm')
								assertFatal(!!absenceReport.startDate, new ParserException('parseAbsences', `!!absenceReport.startDate (was ${undefined})`))
					
								absenceReport.endDate = parseDate(`${absenceReportDateHTML} ${absenceReportEndTime}`, 'dd.MM.yyyy HH:mm')
								assertFatal(!!absenceReport.endDate, new ParserException('parseAbsences', `!!absenceReport.endDate (was ${undefined})`))
					
								absenceReport.lessonAbbreviation = absenceReportFields[2].innerText()?.trim()
								assertFatal(absenceReport.lessonAbbreviation != undefined, new ParserException('parseAbsences', `absenceReport.lessonAbbreviation (was ${undefined})`))
					
								absenceReport.comment = absenceReportFields[3].innerText()?.trim()
								assertFatal(absenceReport.comment != undefined, new ParserException('parseAbsences', `absenceReport.comment (was ${undefined})`))
					
								result.absenceReports.push(absenceReport as AbsenceReport)
							} catch(exception) {
								if(exception instanceof Exception) result.exceptions.push(exception)
								else result.exceptions.push(new JavaScriptException('parseAbsences', `${exception}`))
							}
						}
					}
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseAbsences', `${exception}`))
				}
			}
		
			const openAbsencesTables = dom.querySelector('#uebersicht_bloecke > page form > table')
		
			assertFatal(!!openAbsencesTables, new ParserException('parseAbsences', `!!openAbsencesTables (was ${undefined})`))
			assertFatal(openAbsencesTables.length == 1, new ParserException('parseAbsences', `openAbsencesTables.length == 1 (was ${openAbsencesTables.length})`))
			for(let i = 0; i < openAbsencesTables.length; i++) assertFatal(!!openAbsencesTables[i], new ParserException('parseAbsences', `!!openAbsencesTables[${i}] (was ${undefined})`))
		
			const openAbsenceRows = openAbsencesTables[0].querySelector('tr')
		
			assertFatal(!!openAbsenceRows, new ParserException('parseAbsences', `!!openAbsenceRows (was ${undefined})`))
			assertFatal(openAbsenceRows.length >= 3, new ParserException('parseAbsences', `openAbsenceRows.length >= 3 (was ${openAbsenceRows.length})`))
		
			openAbsenceRows.shift()
			openAbsenceRows.pop()
			openAbsenceRows.pop()
		
			for(let i = 0; i < openAbsenceRows.length; i++) {
				if(!openAbsenceRows[i]) {
					openAbsenceRows.splice(i, 1)
					i--
				}
			}
		
			for(const openAbsenceRow of openAbsenceRows) {
				try {
					const openAbsenceFields = openAbsenceRow.querySelector('td')
			
					assertFatal(!!openAbsenceFields, new ParserException('parseAbsences', `!!openAbsenceFields (was ${undefined})`))
					assertFatal(openAbsenceFields.length == 4, new ParserException('parseAbsences', `openAbsenceFields.length == 4 (was ${openAbsenceFields.length})`))
					for(let i = 0; i < openAbsenceFields.length; i++) assertFatal(!!openAbsenceFields[i], new ParserException('parseAbsences', `!!openAbsenceFields[${i}] (was ${undefined})`))
			
					const openAbsence: Partial<OpenAbsence> = {}
			
					openAbsence.id = generateUUID()
			
					const openAbsenceDateHTML = openAbsenceFields[0].innerText()?.trim()
					assertFatal(!!openAbsenceDateHTML, new ParserException('parseAbsences', `!!openAbsenceDateHTML (was ${openAbsenceDateHTML != undefined ? '\'\'' : undefined})`))
					const openAbsenceTimeHTML = openAbsenceFields[1].innerText()?.trim()
					assertFatal(!!openAbsenceTimeHTML, new ParserException('parseAbsences', `!!openAbsenceTimeHTML (was ${openAbsenceTimeHTML != undefined ? '\'\'' : undefined})`))
					assertFatal(Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length == 1, new ParserException('parseAbsences', `Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length == 1 (was ${Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length})`))
					const [ openAbsenceFromTime, openAbsenceToTime ] = openAbsenceTimeHTML.split('-').map(str => str.trim())
					openAbsence.startDate = parseDate(`${openAbsenceDateHTML} ${openAbsenceFromTime}`, 'dd.MM.yyyy HH:mm')
					assertFatal(!!openAbsence.startDate, new ParserException('parseAbsences', `!!openAbsence.startDate (was ${undefined})`))
					openAbsence.endDate = parseDate(`${openAbsenceDateHTML} ${openAbsenceToTime}`, 'dd.MM.yyyy HH:mm')
					assertFatal(!!openAbsence.endDate, new ParserException('parseAbsences', `!!openAbsence.endDate (was ${undefined})`))
			
					openAbsence.lessonAbbreviation = openAbsenceFields[2].innerText()?.trim()
					assertFatal(openAbsence.lessonAbbreviation != undefined, new ParserException('parseAbsences', `openAbsence.lessonAbbreviation (was ${undefined})`))
			
					result.openAbsences.push(openAbsence as OpenAbsence)
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseAbsences', `${exception}`))
				}
			}
		
			if(tables.length == 2) {
				const lateAbsenceTableRows = tables[1].querySelector('tr')
			
				assertFatal(!!lateAbsenceTableRows, new ParserException('parseAbsences', `!!lateAbsenceTableRows (was ${undefined})`))
				assertFatal(lateAbsenceTableRows.length >= 3, new ParserException('parseAbsences', `lateAbsenceTableRows.length >= 3 (was ${lateAbsenceTableRows.length})`))
			
				lateAbsenceTableRows.shift()
				lateAbsenceTableRows.pop()
				lateAbsenceTableRows.pop()
			
				for(let i = 0; i < lateAbsenceTableRows.length; i++) {
					if(!lateAbsenceTableRows[i]) {
						lateAbsenceTableRows.splice(i, 1)
						i--
					}
				}
			
				for(const lateAbsenceRow of lateAbsenceTableRows) {
					try {
						const lateAbsenceFields = lateAbsenceRow.querySelector('td')
				
						assertFatal(!!lateAbsenceFields, new ParserException('parseAbsences', `!!lateAbsenceFields (was ${undefined})`))
						assertFatal(lateAbsenceFields.length == 5, new ParserException('parseAbsences', `lateAbsenceFields.length == 5 (was ${lateAbsenceFields.length})`))
						for(let i = 0; i < lateAbsenceFields.length; i++) assertFatal(!!lateAbsenceFields[i], new ParserException('parseAbsences', `!!lateAbsenceFields[${i}] (was ${undefined})`))
				
						const lateAbsence: Partial<LateAbsence> = {}
				
						lateAbsence.id = generateUUID()
				
						let lateAbsenceDateHTML = lateAbsenceFields[0].innerText()?.replaceAll('(*)', '')?.trim()
						assertFatal(!!lateAbsenceDateHTML, new ParserException('parseAbsences', `!!lateAbsenceDateHTML (was ${lateAbsenceDateHTML != undefined ? '\'\'' : undefined})`))
						const commaSeparated = lateAbsenceDateHTML.split(',')
						assertFatal(commaSeparated.length == 2, new ParserException('parseAbsences', `commaSeparated.length == 2 (was ${commaSeparated.length})`))
						lateAbsenceDateHTML = commaSeparated[1].trim()
						const lateAbsenceTimeHTML = lateAbsenceFields[1].innerText()?.trim()
						assertFatal(!!lateAbsenceTimeHTML, new ParserException('parseAbsences', `!!lateAbsenceTimeHTML (was ${lateAbsenceTimeHTML != undefined ? '\'\'' : undefined})`))
						lateAbsence.date = parseDate(`${lateAbsenceDateHTML} ${lateAbsenceTimeHTML}`, 'dd.MM.yyyy HH:mm')
						assertFatal(!!lateAbsence.date, new ParserException('parseAbsences', `!!lateAbsence.date (was ${undefined})`))
				
						lateAbsence.reason = lateAbsenceFields[2].innerText()?.trim()
						assertFatal(lateAbsence.reason != undefined, new ParserException('parseAbsences', `lateAbsence.reason != undefined (was ${undefined})`))
				
						const timespan = lateAbsenceFields[3].innerText()?.trim()
						assertFatal(!!timespan, new ParserException('parseAbsences', `!!timespan (was ${timespan != undefined ? '\'\'' : undefined})`))
						lateAbsence.timespan = parseInt(timespan)
						assertFatal(!isNaN(lateAbsence.timespan), new ParserException('parseAbsences', `!isNaN(lateAbsence.timespan) (was ${NaN})`))
				
						const excused = lateAbsenceFields[4].innerText()?.trim()
						assertFatal(!!excused, new ParserException('parseAbsences', `!!excused (was ${excused != undefined ? '\'\'' : undefined})`))
						lateAbsence.excused = excused === 'Ja'
				
						result.lateAbsences.push(lateAbsence as LateAbsence)
					} catch(exception) {
						if(exception instanceof Exception) result.exceptions.push(exception)
						else result.exceptions.push(new JavaScriptException('parseAbsences', `${exception}`))
					}
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('parseAbsences', `${exception}`))
		}
		
		return result
	},
	
	parseGrades(content: string): GradesParserResult {
		const result = new GradesParserResult()
		
		try {
			assertError(!!content, new ParserException('parseGrades', `!!content (was ${content != undefined ? '\'\'' : undefined})`))
		
			let dom: DOMObject | undefined
		
			// TODO: Error handling
			dom = DOMObject.parse(content)
		
			assertError(!!dom, new ParserException('parseGrades', `!!dom (was ${undefined})`))
		
			dom = dom as DOMObject
		
			const subjectRows = dom.querySelector('#uebersicht_bloecke > page > div > table > tbody > tr')
		
			assertFatal(!!subjectRows, new ParserException('parseGrades', `!!subjectRows (was ${undefined})`))
			assertFatal(subjectRows.length >= 1, new ParserException('parseGrades', `subjectRows.length >= 1 (was ${subjectRows.length})`))
			for(let i = 0; i < subjectRows.length; i++) assertFatal(!!subjectRows[i], new ParserException('parseGrades', `!!subjectRows[${i}] (was ${undefined})`))
		
			subjectRows.shift()
		
			for(let subjectRowIndex = 0; subjectRowIndex < subjectRows.length; subjectRowIndex++) {
				try {
					const subjectRow = subjectRows[subjectRowIndex]
					const subjectFields = subjectRow.querySelector('td')
			
					assertFatal(!!subjectFields, new ParserException('parseGrades', `!!subjectFields (was ${undefined})`))
					assertFatal(subjectFields.length == 5, new ParserException('parseGrades', `subjectFields.length == 5 (was ${subjectFields.length})`))
					for(let i = 0; i < subjectFields.length; i++) assertFatal(!!subjectFields[i], new ParserException('parseGrades', `!!subjectFields[${i}] (was ${undefined})`))
			
					const subject: Partial<Subject> = {}
			
					subject.id = generateUUID()
			
					const b = subjectFields[0].querySelector('b')
					assertFatal(!!b, new ParserException('parseGrades', `!!b (was ${undefined})`))
					assertFatal(b.length == 1, new ParserException('parseGrades', `b.length == 1 (was ${b.length})`))
					for(let i = 0; i < b.length; i++) assertFatal(!!b[i], new ParserException('parseGrades', `!!b[${i}] (was ${undefined})`))
			
					subject.abbreviation = b[0].innerText()?.trim()
					assertFatal(subject.abbreviation != undefined, new ParserException('parseGrades', `subject.abbreviation != undefined (was ${undefined})`))
			
					subject.name = subjectFields[0].innerText()?.trim()
					assertFatal(subject.name != undefined, new ParserException('parseGrades', `subject.name != undefined (was ${undefined})`))
			
					subject.hiddenGrades = subjectFields[1].innerText()?.includes('*') ?? false
			
					const a = subjectFields[3].querySelector('a')
					assertFatal(!!a, new ParserException('parseGrades', `!!a (was ${undefined})`))
			
					subject.gradesConfirmed = a.length <= 0
			
					result.subjects.push(subject as Subject)
			
					let gradesRow: DOMObject[]
					const gradeRows: DOMObject[] = []
					while(subjectRowIndex + 1 < subjectRows.length && subjectRows[subjectRowIndex + 1].getAttribute('class')?.includes('detailrow')) {
						subjectRowIndex++
				
						if((gradesRow = subjectRows[subjectRowIndex].querySelector('table')) && gradesRow.length == 1 && gradesRow[0]) {
							const rows = gradesRow[0].querySelector('tr')
					
							assertFatal(!!rows, new ParserException('parseGrades', `!!rows (was ${undefined})`))
							gradeRows.push(...rows)
						}
					}
			
					if(gradeRows.length > 0) {
						assertFatal(gradeRows.length >= 2, new ParserException('parseGrades', `gradeRows.length >= 2 (was ${gradeRows.length})`))
						for(let i = 0; i < gradeRows.length; i++) assertFatal(!!gradeRows[i], new ParserException('parseGrades', `!!gradeRows[${i}] (was ${undefined})`))
				
						gradeRows.shift()
				
						let gradeTotal = 0
						let weightTotal = 0
				
						for(let gradeRowIndex = 0; gradeRowIndex < gradeRows.length; gradeRowIndex++) {
							try {
								const gradeRow = gradeRows[gradeRowIndex]
								const gradeFields = gradeRow.querySelector('td')
					
								assertFatal(!!gradeFields, new ParserException('parseGrades', `!!gradeFields (was ${undefined})`))
								if(gradeFields.length == 2 && gradeRowIndex + 1 == gradeRows.length) continue
								assertFatal(gradeFields.length == 4, new ParserException('parseGrades', `gradeFields.length == 4 (was ${gradeFields.length})`))
								for(let i = 0; i < gradeFields.length; i++) assertFatal(!!gradeFields[i], new ParserException('parseGrades', `!!gradeFields[${i}] (was ${undefined})`))
					
								const grade: Partial<Grade> = {}
					
								grade.id = generateUUID()
					
								grade.subjectId = subject.id
					
								const gradeDateHTML = gradeFields[0].innerText()?.trim()
								if(gradeDateHTML) {
									grade.date = parseDate(`${gradeDateHTML}`, 'dd.MM.yyyy')
									assertWarn(!!grade.date, new ParserException('parseGrades', `!!grade.date (was ${undefined})`))
								}
					
								grade.topic = gradeFields[1].innerText()?.trim()
								assertFatal(grade.topic != undefined, new ParserException('parseGrades', `grade.topic (was ${undefined})`))
					
								const gradeHTML = gradeFields[2].innerText()?.trim()
								grade.grade = gradeHTML ? parseFloat(gradeHTML) : undefined
								if(grade.grade != undefined && isNaN(grade.grade)) grade.grade = undefined
					
								const detailsDiv = gradeFields[2].querySelector('div')
								if(detailsDiv && detailsDiv.length == 1 && detailsDiv[0]) grade.details = detailsDiv[0].innerText()?.trim()
					
								grade.weight = parseFloat(gradeFields[3].innerText()?.trim())
								assertFatal(!isNaN(grade.weight), new ParserException('parseGrades', `!isNaN(grade.weight) (was ${NaN})`))
					
								if(grade.grade) {
									const weight = grade.weight ?? 1
									gradeTotal += grade.grade * weight
									weightTotal += weight
								}
					
								result.grades.push(grade as Grade)
							} catch(exception) {
								if(exception instanceof Exception) result.exceptions.push(exception)
								else result.exceptions.push(new JavaScriptException('parseGrades', `${exception}`))
							}
						}
				
						subject.average = weightTotal > 0 ? gradeTotal / weightTotal : undefined
					}
			
					if(subjectRowIndex + 1 < subjectRows.length && subjectRows[subjectRowIndex + 1].getAttribute('id')?.includes('schueleruebersicht_verlauf')) subjectRowIndex++
				} catch(exception) {
					if(exception instanceof Exception) result.exceptions.push(exception)
					else result.exceptions.push(new JavaScriptException('parseGrades', `${exception}`))
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('parseGrades', `${exception}`))
		}
		
		return result
	},
} as const

/********\
| Linker |
\********/

// TODO: Error handling + recovery

class LinkResult extends User {
	exceptions: Exception[] = []
}

function link(user: Partial<User>) {
	const result = new LinkResult()
	
	const teacherTable: { [ key: string ]: Teacher } = {}
	const subjectTable: { [ key: string ]: Subject } = {}
	
	const subjectIdTable = new Map<UniqueId, Subject>()
	const absenceIdTable = new Map<UniqueId, Absence>()
	
	for(const teacher of user.teachers ?? []) {
		teacherTable[teacher.abbreviation] = teacher
	}
	
	for(const subject of user.subjects ?? []) {
		try {
			subjectTable[subject.abbreviation] = subject
			subjectIdTable.set(subject.id, subject)
		
			assertFatal(!!subject.abbreviation, new LinkerException('Subjects', `!!subject.abbreviation (was ${subject.abbreviation != undefined ? '\'\'' : undefined})`))
			const [ , , teacherAbbreviation ] = subject.abbreviation.split('-')
			assertFatal(!!teacherAbbreviation, new LinkerException('Subjects', `!!teacherAbbreviation (was ${teacherAbbreviation != undefined ? '\'\'' : undefined})`))
		
			const teacher = teacherTable[teacherAbbreviation]
			assertInfo(!!teacher, new LinkerException('Subjects', `!!teacher (was ${undefined})`))
			if(!teacher) continue
		
			subject.teacherId = teacher.id
			if(!teacher.subjectIds) teacher.subjectIds = []
			teacher.subjectIds.push(subject.id)
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('link(Subjects)', `${exception}`))
		}
	}
	
	for(const grade of user.grades ?? []) {
		try {
			const subject = subjectIdTable.get(grade.subjectId)
			assertFatal(!!subject, new LinkerException('Grades', `!!subject (was ${undefined})`))
		
			if(!subject) continue
		
			if(!subject.gradeIds) subject.gradeIds = []
			subject.gradeIds.push(grade.id)
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('link(Grades)', `${exception}`))
		}
	}
	
	for(const openAbsence of user.openAbsences ?? []) {
		try {
			const subject = subjectTable[openAbsence.lessonAbbreviation]
			assertInfo(!!subject, new LinkerException('OpenAbsences', `!!subject (was ${undefined})`))
			if(!subject) continue
		
			openAbsence.subjectId = subject.id
			if(!subject.openAbsenceIds) subject.openAbsenceIds = []
			subject.openAbsenceIds.push(openAbsence.id)
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('link(OpenAbsences)', `${exception}`))
		}
	}
	
	for(const absence of user.absences ?? []) absenceIdTable.set(absence.id, absence)
	
	for(const absenceReport of user.absenceReports ?? []) {
		try {
			const subject = subjectTable[absenceReport.lessonAbbreviation]
			assertInfo(!!subject, new LinkerException('AbsenceReports', `!!subject (was ${undefined})`))
			if(subject) {
				if(!subject.absenceReportIds) subject.absenceReportIds = []
				subject.absenceReportIds.push(absenceReport.id)
				absenceReport.subjectId = subject.id
			}
		
			const absence = absenceIdTable.get(absenceReport.absenceId)
			assertFatal(!!absence, new LinkerException('AbsenceReports', `!!absence (was ${undefined})`))
			if(!absence) continue
		
			if(!absence.absenceReportIds) absence.absenceReportIds = []
			absence.absenceReportIds.push(absenceReport.id)
			absenceReport.absenceId = absence.id
		
			if(subject) {
				if(!absence.subjectIds) absence.subjectIds = []
				if(!absence.subjectIds.includes(subject.id)) {
					absence.subjectIds.push(subject.id)
					if(!subject.absenceIds) subject.absenceIds = []
					subject.absenceIds.push(absence.id)
				}
			}
		} catch(exception) {
			if(exception instanceof Exception) result.exceptions.push(exception)
			else result.exceptions.push(new JavaScriptException('link(AbsenceReports)', `${exception}`))
		}
	}
	
	Object.assign(result, user)
	
	return result
}

/*********\
| Diffing |
\*********/

enum ObjectType {
	TEACHER,
	STUDENT,
	TRANSACTION,
	ABSENCE,
	ABSENCE_REPORT,
	OPEN_ABSENCE,
	LATE_ABSENCE,
	SUBJECT,
	GRADE,
}

type ObjectTypeMap = [Teacher, Student, Transaction, Absence, AbsenceReport, OpenAbsence, LateAbsence, Subject, Grade]
type AnyObjectType = Teacher & Student & Transaction & Absence & AbsenceReport & OpenAbsence & LateAbsence & Subject & Grade

// TODO: Relationships
const IdenitityKeys: { [key in ObjectType]: (keyof ObjectTypeMap[key])[] } = {
	[ObjectType.TEACHER]: ['lastName', 'firstName', 'abbreviation'],
	[ObjectType.STUDENT]: ['lastName', 'firstName'],
	[ObjectType.TRANSACTION]: ['date', 'reason'],
	[ObjectType.ABSENCE]: ['startDate', 'endDate'],
	[ObjectType.ABSENCE_REPORT]: ['startDate', 'endDate', 'lessonAbbreviation'],
	[ObjectType.OPEN_ABSENCE]: ['startDate', 'endDate', 'lessonAbbreviation'],
	[ObjectType.LATE_ABSENCE]: ['date', 'reason', 'timespan'],
	[ObjectType.SUBJECT]: ['abbreviation'],
	[ObjectType.GRADE]: ['date', 'topic'],
}

const same = (first: unknown, second: unknown) => {
	if(typeof first != typeof second) return false
	else if(first === second) return true
	else if(typeof first === 'object' && typeof second === 'object' && first && second) {
		if(!('$type' in first) || (first as { $type: unknown }).$type != (second as { $type: unknown }).$type || typeof (first as { $type: unknown }).$type in ObjectType || !((first as { $type: ObjectType }).$type in ObjectType)) return false
		
		for(const key of IdenitityKeys[(first as { $type: ObjectType }).$type]) {
			if(!same((first as AnyObjectType)[key], (second as AnyObjectType)[key])) return false
		}
		
		return true
	} else return false
}

const CompareKeys: { [key in ObjectType]: (keyof ObjectTypeMap[key])[] } = {
	[ObjectType.TEACHER]: ['email'],
	[ObjectType.STUDENT]: ['gender', 'degree', 'bilingual', 'clazz', 'address', 'zip', 'city', 'phone', 'additionalClass', 'status'],
	[ObjectType.TRANSACTION]: ['amount'],
	[ObjectType.ABSENCE]: ['reason', 'additionalInfo', 'deadline', 'excused', 'lessonCount'],
	[ObjectType.ABSENCE_REPORT]: ['comment'],
	[ObjectType.OPEN_ABSENCE]: [],
	[ObjectType.LATE_ABSENCE]: ['excused'],
	[ObjectType.SUBJECT]: ['name', 'gradesConfirmed', 'hiddenGrades'], // currently excluding `average`
	[ObjectType.GRADE]: ['grade', 'details', 'weight'],
}

const equal = (first: unknown, second: unknown) => {
	if(!same(first, second)) return false
	if(typeof first !== 'object') return true
	
	for(const key of CompareKeys[(first as { $type: ObjectType }).$type]) {
		if(!equal((first as AnyObjectType)[key], (second as AnyObjectType)[key])) return false
	}
	
	return true
}

class DiffingResult<T> {
	added: T[] = []
	modified: [T, T][] = []
	removed: T[] = []
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function diff<T>(initial: T | T[], updated: T | T[]) {
	const result = new DiffingResult<T>()
	
	const firstArray = Array.isArray(initial) ? [...initial] : [initial]
	const secondArray = Array.isArray(updated) ? [...updated] : [updated]
	
	for(let firstIndex = 0; firstIndex < firstArray.length; firstIndex++) {
		for(let secondIndex = 0; secondIndex < secondArray.length; secondIndex++) {
			if(same(firstArray[firstIndex], secondArray[secondIndex])) {
				if(!equal(firstArray[firstIndex], secondArray[secondIndex])) {
					result.modified.push([firstArray[firstIndex], secondArray[secondIndex]])
				}
				
				firstArray.splice(firstIndex, 1)
				secondArray.splice(secondIndex, 1)
				firstIndex--
				
				break
			}
		}
	}
	
	result.removed = firstArray
	result.added = secondArray
	
	return result
}

/**********\
| Fetchers |
\**********/

const Fetcher = {
	fetchAbsences: async (session: Session, user?: User) => {
		const data = await session.fetchPage(Page.ABSENCES, true, { action: 'toggle_abs_showall' })
		if(!data) return undefined
		
		const parsed = Parser.parseAbsences(data)
		
		if(user) link({ ...user, ...parsed })
		
		return parsed
	},
	
	fetchGrades: async (session: Session, user?: User) => {
		const data = await session.fetchPage(Page.GRADES, true)
		if(!data) return undefined
		
		const parsed = Parser.parseGrades(data)
		
		if(user) link({ ...user, ...parsed })
		
		return parsed
	},
	
	fetchStudents: async (session: Session, user?: User) => {
		await session.fetchPage(Page.STUDENTS, true)
		
		const data = await session.fetchPage(Page.DOCUMENT_DOWNLOAD, false, { tblName: 'Kursliste', 'export_all': 1 })
		if(!data) return undefined
		
		const parsed = Parser.parseStudents(data)
		
		if(user) link({ ...user, ...parsed })
		
		return parsed
	},
	
	fetchTeachers: async (session: Session, user?: User) => {
		await session.fetchPage(Page.TEACHERS, true)
		
		const data = await session.fetchPage(Page.DOCUMENT_DOWNLOAD, false, { tblName: 'Lehrerliste', 'export_all': 1 })
		if(!data) return undefined
		
		const parsed = Parser.parseTeachers(data)
		
		if(user) link({ ...user, ...parsed })
		
		return parsed
	},
	
	fetchTransactions: async (session: Session, user?: User) => {
		const data = await session.fetchPage(Page.TRANSACTIONS, true)
		if(!data) return undefined
		
		const parsed = Parser.parseTransactions(data)
		
		if(user) link({ ...user, ...parsed })
		
		return parsed
	},
} as const

/************************\
| Testing (TODO: Remove) |
\************************/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function run(provider: string, username: string, password: string) {
	let user = {} as User
	
	const session = new Session(provider, username, password)
	await session.login()
	
	user = { ...user, ...await Fetcher.fetchAbsences(session, user) }
	user = { ...user, ...await Fetcher.fetchGrades(session, user) }
	user = { ...user, ...await Fetcher.fetchStudents(session, user) }
	user = { ...user, ...await Fetcher.fetchTeachers(session, user) }
	user = { ...user, ...await Fetcher.fetchTransactions(session, user) }
	
	await session.logout()
	
	link(user)
	
	return user
}

//Confirm Grade (index starts with 0): https://ksw.nesa-sg.ch/index.php?pageid=21311&action=nvw_bestaetigen&id=66fb5304d45d7068&transid=e9a99d&listindex=1
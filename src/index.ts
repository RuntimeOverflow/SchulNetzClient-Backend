import { Absence, AbsenceObj, AbsenceReport, AbsenceReportObj, cancelWait, DOMObject, error, extractQueryParameters, fatal, generateUUID, Grade, GradeObj, info, LateAbsence, LateAbsenceObj, Objectify, OpenAbsence, OpenAbsenceObj, parseDate, request, Response, Student, StudentObj, Subject, SubjectObj, Teacher, TeacherObj, Transaction, TransactionObj, UniqueId, wait, warn } from './env.js'

/*******************\
| Utility Functions |
\*******************/

function assert(condition: boolean, errorMessage: string): void | never {
	if(!condition) throw new Error(errorMessage)
}

function assertInfo(condition: boolean, errorMessage: string): void | never {
	if(!condition) info(errorMessage)
}

function assertWarn(condition: boolean, errorMessage: string): void | never {
	if(!condition) {
		warn(errorMessage)
		throw new Error(errorMessage)
	}
}

function assertError(condition: boolean, errorMessage: string): void | never {
	if(!condition) {
		error(errorMessage)
		throw new Error(errorMessage)
	}
}

function assertFatal(condition: boolean, errorMessage: string): void | never {
	if(!condition) {
		fatal(errorMessage)
		throw new Error(errorMessage)
	}
}

/***********\
| Constants |
\***********/

enum Pages {
	ABSENCES = 21111,
	TEACHERS = 22352,
	STUDENTS = 22348,
	TRANSACTIONS = 21411,
	SUBJECTS = 22348,
	GRADES = 21311,
	SCHEDULE = 22202,
	DOCUMENT_DOWNLOAD = 1012,
}

type Page = Pages

type User = { teachers: Teacher[], students: Student[], transactions: Transaction[], absences: Absence[], absenceReports: AbsenceReport[], openAbsences: OpenAbsence[], lateAbsences: LateAbsence[], subjects: Subject[], grades: Grade[] }

type UserObj = { teachers: TeacherObj[], students: StudentObj[], transactions: TransactionObj[], absences: AbsenceObj[], absenceReports: AbsenceReportObj[], openAbsences: OpenAbsenceObj[], lateAbsences: LateAbsenceObj[], subjects: SubjectObj[], grades: GradeObj[] }

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
		try {
			const links = dom.querySelector('#header-menu ul[for=sn-main-menu] > li:nth-child(1) > a')
			assert(links.length == 1, 'dom.querySelector(\'#header-menu ul[for=sn-main-menu] > li:nth-child(1) > a\').length != 1')
			
			const { id, transid } = extractQueryParameters(links[0].getAttribute('href'), 'https://' + this.provider)
			assert(!!id, 'id == null || id == \'\'')
			assert(!!transid, 'transid == null || transid == \'\'')
			this.id = id as string
			this.transId = transid as string
		} catch(e) {
			warn(`${e}`)
			
			return false
		}
		
		return true
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
		if(resp.headers['set-cookie']) {
			let raw = resp.headers['set-cookie']
			
			let key: string | undefined = undefined
			let metadata = false
			
			let match
			while(match = /(^.*?)([;=,])/.exec(raw)) {
				if(match && match.length == 3) {
					raw = raw.substring(match[0].length).trim()
					
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
		assert(!!stateLock, 'login(): Failed to acquire state lock')
		stateLock = stateLock as symbol
		
		try {
			if(this.loggedIn) {
				this.releaseStateLock(stateLock)
				return
			}
			
			let html = await request(`https://${this.provider}/loginto.php`)
			this.updateCookies(html)
			const dom = DOMObject.parse(html.content)
			
			const loginHashInputs = dom.querySelector('#standardformular input[type=hidden][name=loginhash]')
			assert(loginHashInputs.length == 1, 'login(): dom.querySelector(\'#standardformular input[type=hidden][name=loginhash]\').length != 1')
			
			const loginHash = loginHashInputs[0].getAttribute('value')
			assert(!!loginHash, 'loginHash == null || loginHash == \'\'')
			
			html = await request(`https://${this.provider}/index.php`, { method: 'POST', body: `login=${encodeURIComponent(this.username)}&passwort=${encodeURIComponent(this.password)}&loginhash=${encodeURIComponent(loginHash)}`, headers: { 'Cookie': this.cookieString }, ignoreStatusCode: true })
			this.updateCookies(html)
			
			const success = this.verifyPageAndExtractIds(DOMObject.parse(html.content))
			assert(success, 'login(): verifyPageAndExtractIds() == false')
			
			this.loggedIn = true
			this.lastVisitedPageId = 1
			this.sessionTimer()
		} catch(error) {
			this.handleLogout()
			
			throw error
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
		if(!this.loggedIn) return undefined
		
		let stateLock: symbol | undefined
		
		if(changesState) {
			stateLock = await this.acquireStateLock()
			assert(!!stateLock, `fetchPage(${pageId}): Failed to acquire state lock`)
		} else {
			const success = await this.retainStableState()
			assert(success, `fetchPage(${pageId}): Failed to retain stable state`)
		}
		
		let html: string | undefined
		
		try {
			const response = await request(`https://${this.provider}/index.php?pageid=${pageId}&id=${this.id}&transid=${this.transId}${Object.entries(additionalQueryParameters).map(([ key, value ]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('')}`, { method: 'GET', headers: { 'Cookie': this.cookieString } })
			
			html = response.content
			
			if(changesState) {
				this.verifyPageAndExtractIds(DOMObject.parse(html))
			}
			
			this.visitedPageIds.add(pageId)
		} catch(e) {
			error(`${e}`)
			
			html = undefined
			
			this.handleLogout()
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

/*********\
| Parsers |
\*********/

const Parser = {
	parseTeachers(content: string) {
		assertError(!!content, `parseTeachers: !!content (was ${content != undefined ? '\'\'' : undefined})`)
		
		const lines = content.trim().replace(/[\r\n]+/g, '\n').split('\n')
		
		assertFatal(lines.length >= 1, `parseTeachers: lines.length >= 1 (was ${lines.length})`)
		
		lines.shift()
		
		const teachers: TeacherObj[] = []
		
		let line: string | undefined
		while((line = lines.shift()) != undefined) {
			line = line.trim()
			
			const matches = Array.from(line.matchAll(/"(([^"]|"")*)"/g))
			
			assertFatal(matches.length == 4, `parseTeachers: matches.length == 4 (was ${matches.length})`)
			for(let i = 0; i < matches.length; i++) {
				assertFatal(!!matches[i], `parseTeachers: !!matches[${i}] (was ${undefined})`)
				assertFatal(matches[i].length >= 2, `parseTeachers: matches[${i}].length >= 2 (was ${matches[i].length})`)
				assertFatal(typeof matches[i][1] === 'string', `parseTeachers: typeof matches[${i}][1] === 'string' (was ${typeof matches[i][1]})`)
			}
			
			const teacher: Partial<TeacherObj> = {}
			
			teacher.id = generateUUID()
			
			teacher.lastName = matches[0][1].trim().replace(/""/g, '"')
			teacher.firstName = matches[1][1].trim().replace(/""/g, '"')
			teacher.abbreviation = matches[2][1].trim().replace(/""/g, '"')
			teacher.email = matches[3][1].trim().replace(/""/g, '"')
			
			teachers.push(teacher as TeacherObj)
		}
		
		return { teachers } as Partial<UserObj>
	},
	
	parseStudents(content: string) {
		assertError(!!content, `parseCourseParticipants: !!content (was ${content != undefined ? '\'\'' : undefined})`)
		
		const lines = content.trim().replace(/[\r\n]+/g, '\n').split('\n')
		
		assertError(!!lines, `parseCourseParticipants: !!lines (was ${lines})`)
		assertFatal(lines.length > 0, `parseCourseParticipants: lines.length > 0 (was ${lines.length})`)
		
		lines.shift()
		
		const students: StudentObj[] = []
		
		let line: string | undefined
		while((line = lines.shift()) != undefined) {
			line = line.trim()
			
			const matches = Array.from(line.matchAll(/"(([^"]|"")*)"/g))
			
			assertFatal(matches.length == 12, `parseCourseParticipants: matches.length == 12 (was ${matches.length})`)
			for(let i = 0; i < matches.length; i++) {
				assertFatal(!!matches[i], `parseCourseParticipants: !!matches[${i}] (was ${undefined})`)
				assertFatal(matches[i].length >= 2, `parseCourseParticipants: matches[${i}].length >= 2 (was ${matches[i].length})`)
				assertFatal(typeof matches[i][1] === 'string', `parseCourseParticipants: typeof matches[${i}][1] === 'string' (was ${typeof matches[i][1]})`)
			}
			
			const student: Partial<StudentObj> = {}
			
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
			assertError(!isNaN(student.zip), `parseCourseParticipants: !isNaN(student.zip) (was ${NaN})`)
			
			student.city = matches[8][1].trim().replace(/""/g, '"')
			student.phone = matches[9][1].trim().replace(/""/g, '"')
			student.additionalClass = matches[10][1].trim().replace(/""/g, '"')
			student.status = matches[11][1].trim().replace(/""/g, '"')
			
			students.push(student as StudentObj)
		}
		
		return { students } as Partial<UserObj>
	},
	
	parseTransactions(content: string) {
		assertError(!!content, `parseTransactions: !!content (was ${content != undefined ? '\'\'' : undefined})`)
		
		let dom: DOMObject | undefined
		
		try {
			dom = DOMObject.parse(content)
		} catch(error) {
			assertError(false, `parseTransactions: DOMObject.parse(content) errored (threw '${error}')`)
		}
		
		assertError(!!dom, `parseTransactions: !!dom (was ${undefined})`)
		
		dom = dom as DOMObject
		
		const tables = dom.querySelector('#content-card > table')
		
		assertFatal(!!tables, `parseTransactions: !!tables (was ${undefined})`)
		assertFatal(tables.length == 2, `parseTransactions: tables.length == 2 (was ${tables.length})`)
		assertFatal(!!tables[1], `parseTransactions: !!tables[1] (was ${undefined})`)
		
		const table = tables[1]
		
		const rows = table.querySelector('tr')
		
		assertFatal(!!rows, `parseTransactions: !!rows (was ${undefined})`)
		assertFatal(rows.length >= 2, `parseTransactions: rows.length >= 2 (was ${rows.length})`)
		
		rows.shift()
		rows.pop()
		
		for(let i = 0; i < rows.length; i++) {
			if(!rows[i]) {
				rows.splice(i, 1)
				i--
			}
		}
		
		const transactions: TransactionObj[] = []
		
		for(const row of rows) {
			const fields = row.querySelector('td')
			
			assertFatal(!!fields, `parseTransactions: !!fields (was ${undefined})`)
			assertFatal(fields.length == 4, `parseTransactions: fields.length == 4 (was ${fields.length})`)
			for(let i = 0; i < fields.length; i++) assertFatal(!!fields[i], `parseTransactions: !!fields[${i}] (was ${undefined})`)
			
			const transaction: Partial<TransactionObj> = {}
			
			transaction.id = generateUUID()
			
			const dateHTML = fields[0].innerText()?.trim()
			assertFatal(!!dateHTML, `parseTransactions: !!dateHTML (was ${dateHTML != undefined ? '\'\'' : undefined})`)
			transaction.date = parseDate(dateHTML, 'dd.MM.yyyy')
			
			transaction.reason = fields[1].innerText()?.trim()
			assertFatal(!!transaction.reason, `parseTransactions: !!transaction.reason (was ${transaction.reason != undefined ? '\'\'' : undefined})`)
			
			const amountElement = fields[2].querySelector('span')
			assertFatal(!!amountElement, `parseTransactions: !!amountElement (was ${undefined})`)
			assertFatal(amountElement.length == 1, `parseTransactions: amountElement.length == 4 (was ${amountElement.length})`)
			assertFatal(!!amountElement[0], `parseTransactions: !!amountElement[0] (was ${undefined})`)
			
			const amountHTML = amountElement[0].innerText()?.trim()
			assertFatal(!!amountHTML, `parseTransactions: !!amountHTML (was ${amountHTML != undefined ? '\'\'' : undefined})`)
			transaction.amount = parseFloat(amountHTML)
			assertFatal(!isNaN(transaction.amount), `parseTransactions: !isNaN(transaction.amount) (was ${NaN})`)
			
			transactions.push(transaction as TransactionObj)
		}
		
		return { transactions } as Partial<UserObj>
	},
	
	parseAbsences(content: string) {
		assertError(!!content, `parseAbsences: !!content (was ${content != undefined ? '\'\'' : undefined})`)
		
		let dom: DOMObject | undefined
		
		try {
			dom = DOMObject.parse(content)
		} catch(error) {
			assertError(false, `parseAbsences: DOMObject.parse(content) errored (threw '${error}')`)
		}
		
		assertError(!!dom, `parseAbsences: !!dom (was ${undefined})`)
		
		dom = dom as DOMObject
		
		const tables = dom.querySelector('#uebersicht_bloecke > page > div > table')
		
		assertFatal(!!tables, `parseAbsences: !!tables (was ${undefined})`)
		assertFatal(tables.length == 1 || tables.length == 2, `parseAbsences: tables.length == 1 || tables.length == 2 (was ${tables.length})`)
		for(let i = 0; i < tables.length; i++) assertFatal(!!tables[i], `parseAbsences: !!tables[${i}] (was ${undefined})`)
		
		const absences: AbsenceObj[] = []
		const absenceReports: AbsenceReportObj[] = []
		
		const absenceRows = tables[0].querySelector('table.mdl-data-table > tbody > tr')
		
		assertFatal(!!absenceRows, `parseAbsences: !!absenceRows (was ${undefined})`)
		
		if(absenceRows.length > 0 && absenceRows[absenceRows.length - 1].querySelector('button').length > 0) absenceRows.pop()
		
		assertFatal(absenceRows.length >= 3, `parseAbsences: absenceRows.length >= 3 (was ${absenceRows.length})`)
		assertFatal((absenceRows.length - 3) % 2 == 0, `parseAbsences: (absenceRows.length - 3) % 2 == 0 (was ${absenceRows.length})`)
		
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
			const absenceRow = absenceRows[absenceRowIndex]
			const absenceFields = absenceRow.querySelector('td')
			
			assertFatal(!!absenceFields, `parseAbsences: !!absenceFields (was ${undefined})`)
			assertFatal(absenceFields.length == 7, `parseAbsences: absenceFields.length == 7 (was ${absenceFields.length})`)
			for(let i = 0; i < absenceFields.length; i++) assertFatal(!!absenceFields[i], `parseAbsences: !!absenceFields[${i}] (was ${undefined})`)
			
			const absence: Partial<AbsenceObj> = {}
			
			absence.id = generateUUID()
			
			const absenceFromDateHTML = absenceFields[0].innerText()?.trim()
			assertFatal(!!absenceFromDateHTML, `parseAbsences: !!absenceFromDateHTML (was ${absenceFromDateHTML != undefined ? '\'\'' : undefined})`)
			const absenceToDateHTML = absenceFields[1].innerText()?.trim()
			assertFatal(!!absenceToDateHTML, `parseAbsences: !!absenceToDateHTML (was ${absenceToDateHTML != undefined ? '\'\'' : undefined})`)
			
			absence.startDate = parseDate(absenceFromDateHTML, 'dd.MM.yyyy')
			assertFatal(!!absence.startDate, `parseAbsences: !!absence.startDate (was ${undefined})`)
			absence.endDate = parseDate(absenceToDateHTML, 'dd.MM.yyyy')
			assertFatal(!!absence.endDate, `parseAbsences: !!absence.endDate (was ${undefined})`)
			
			absence.reason = absenceFields[2].innerText()?.trim()
			assertFatal(absence.reason != undefined, `parseAbsences: absence.reason (was ${undefined})`)
			
			absence.additionalInfo = absenceFields[3].innerText()?.trim()
			assertFatal(absence.additionalInfo != undefined, `parseAbsences: absence.additionalInfo (was ${undefined})`)
			
			absence.deadline = absenceFields[4].innerText()?.trim()
			assertFatal(absence.deadline != undefined, `parseAbsences: absence.deadline (was ${undefined})`)
			
			const excused = absenceFields[5].innerText()?.trim()
			assertFatal(excused != undefined, `parseAbsences: excused (was ${undefined})`)
			absence.excused = excused === 'Ja'
			
			const lessonCount = absenceFields[6].innerText()?.trim()
			assertFatal(lessonCount != undefined, `parseAbsences: lessonCount (was ${undefined})`)
			absence.lessonCount = parseInt(lessonCount)
			assertFatal(!isNaN(absence.lessonCount), `parseAbsences: !isNaN(absence.lessonCount) (was ${NaN})`)
			
			absences.push(absence as AbsenceObj)
			
			let reportsTable: DOMObject
			if(absenceRowIndex + 1 < absenceRows.length && ([ reportsTable ] = absenceRows[absenceRowIndex + 1].querySelector('tr table')) && reportsTable) {
				absenceRowIndex++
				
				const absenceReportRows = reportsTable.querySelector('tr')
				
				assertFatal(!!absenceReportRows, `parseAbsences: !!absenceReportRows (was ${undefined})`)
				assertFatal(absenceReportRows.length >= 2, `parseAbsences: absenceReportRows.length >= 2 (was ${absenceReportRows.length})`)
				for(let i = 0; i < absenceReportRows.length; i++) assertFatal(!!absenceReportRows[i], `parseAbsences: !!absenceReportRows[${i}] (was ${undefined})`)
				
				absenceReportRows.shift()
				absenceReportRows.shift()
				
				for(let absenceReportRowIndex = 0; absenceReportRowIndex < absenceReportRows.length; absenceReportRowIndex++) {
					const absenceReportRow = absenceReportRows[absenceReportRowIndex]
					const absenceReportFields = absenceReportRow.querySelector('td')
					
					assertFatal(!!absenceReportFields, `parseAbsences: !!absenceReportFields (was ${undefined})`)
					assertFatal(absenceReportFields.length == 4, `parseAbsences: absenceReportFields.length == 7 (was ${absenceReportFields.length})`)
					for(let i = 0; i < absenceReportFields.length; i++) assertFatal(!!absenceReportFields[i], `parseAbsences: !!absenceReportFields[${i}] (was ${undefined})`)
					
					const absenceReport: Partial<AbsenceReportObj> = {}
					
					absenceReport.id = generateUUID()
					
					absenceReport.absenceId = absence.id
					
					const absenceReportDateHTML = absenceReportFields[0].innerText()?.trim()
					assertFatal(!!absenceReportDateHTML, `parseAbsences: !!absenceReportDateHTML (was ${absenceReportDateHTML != undefined ? '\'\'' : undefined})`)
					
					const absenceReportTimeHTML = absenceReportFields[1].innerText()?.trim()
					assertFatal(!!absenceReportTimeHTML, `parseAbsences: !!absenceReportTimeHTML (was ${absenceReportTimeHTML != undefined ? '\'\'' : undefined})`)
					const [ absenceReportStartTime, absenceReportEndTime ] = absenceReportTimeHTML.split('bis').map(str => str.trim())
					assertFatal(!!absenceReportStartTime, `parseAbsences: !!absenceReportStartTime (was ${absenceReportStartTime != undefined ? '\'\'' : undefined})`)
					assertFatal(!!absenceReportEndTime, `parseAbsences: !!absenceReportEndTime (was ${absenceReportEndTime != undefined ? '\'\'' : undefined})`)
					
					absenceReport.startDate = parseDate(`${absenceReportDateHTML} ${absenceReportStartTime}`, 'dd.MM.yyyy HH:mm')
					assertFatal(!!absenceReport.startDate, `parseAbsences: !!absenceReport.startDate (was ${undefined})`)
					
					absenceReport.endDate = parseDate(`${absenceReportDateHTML} ${absenceReportEndTime}`, 'dd.MM.yyyy HH:mm')
					assertFatal(!!absenceReport.endDate, `parseAbsences: !!absenceReport.endDate (was ${undefined})`)
					
					absenceReport.lessonAbbreviation = absenceReportFields[2].innerText()?.trim()
					assertFatal(absenceReport.lessonAbbreviation != undefined, `parseAbsences: absenceReport.lessonAbbreviation (was ${undefined})`)
					
					absenceReport.comment = absenceReportFields[3].innerText()?.trim()
					assertFatal(absenceReport.comment != undefined, `parseAbsences: absenceReport.comment (was ${undefined})`)
					
					absenceReports.push(absenceReport as AbsenceReportObj)
				}
			}
		}
		
		const openAbsencesTables = dom.querySelector('#uebersicht_bloecke > page form > table')
		
		assertFatal(!!openAbsencesTables, `parseAbsences: !!openAbsencesTables (was ${undefined})`)
		assertFatal(openAbsencesTables.length == 1, `parseAbsences: openAbsencesTables.length == 1 (was ${openAbsencesTables.length})`)
		for(let i = 0; i < openAbsencesTables.length; i++) assertFatal(!!openAbsencesTables[i], `parseAbsences: !!openAbsencesTables[${i}] (was ${undefined})`)
		
		const openAbsences: OpenAbsenceObj[] = []
		
		const openAbsenceRows = openAbsencesTables[0].querySelector('tr')
		
		assertFatal(!!openAbsenceRows, `parseAbsences: !!openAbsenceRows (was ${undefined})`)
		assertFatal(openAbsenceRows.length >= 3, `parseAbsences: openAbsenceRows.length >= 3 (was ${openAbsenceRows.length})`)
		
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
			const openAbsenceFields = openAbsenceRow.querySelector('td')
			
			assertFatal(!!openAbsenceFields, `parseAbsences: !!openAbsenceFields (was ${undefined})`)
			assertFatal(openAbsenceFields.length == 4, `parseAbsences: openAbsenceFields.length == 4 (was ${openAbsenceFields.length})`)
			for(let i = 0; i < openAbsenceFields.length; i++) assertFatal(!!openAbsenceFields[i], `parseAbsences: !!openAbsenceFields[${i}] (was ${undefined})`)
			
			const openAbsence: Partial<OpenAbsenceObj> = {}
			
			openAbsence.id = generateUUID()
			
			const openAbsenceDateHTML = openAbsenceFields[0].innerText()?.trim()
			assertFatal(!!openAbsenceDateHTML, `parseAbsences: !!openAbsenceDateHTML (was ${openAbsenceDateHTML != undefined ? '\'\'' : undefined})`)
			const openAbsenceTimeHTML = openAbsenceFields[1].innerText()?.trim()
			assertFatal(!!openAbsenceTimeHTML, `parseAbsences: !!openAbsenceTimeHTML (was ${openAbsenceTimeHTML != undefined ? '\'\'' : undefined})`)
			assertFatal(Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length == 1, `parseAbsences: Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length == 1 (was ${Array.from(openAbsenceTimeHTML.matchAll(/-/g)).length})`)
			const [ openAbsenceFromTime, openAbsenceToTime ] = openAbsenceTimeHTML.split('-').map(str => str.trim())
			openAbsence.startDate = parseDate(`${openAbsenceDateHTML} ${openAbsenceFromTime}`, 'dd.MM.yyyy HH:mm')
			assertFatal(!!openAbsence.startDate, `parseAbsences: !!openAbsence.startDate (was ${undefined})`)
			openAbsence.endDate = parseDate(`${openAbsenceDateHTML} ${openAbsenceToTime}`, 'dd.MM.yyyy HH:mm')
			assertFatal(!!openAbsence.endDate, `parseAbsences: !!openAbsence.endDate (was ${undefined})`)
			
			openAbsence.lessonAbbreviation = openAbsenceFields[2].innerText()?.trim()
			assertFatal(openAbsence.lessonAbbreviation != undefined, `parseAbsences: openAbsence.lessonAbbreviation (was ${undefined})`)
			
			openAbsences.push(openAbsence as OpenAbsenceObj)
		}
		
		const lateAbsences: LateAbsenceObj[] = []
		
		if(tables.length == 2) {
			const lateAbsenceTableRows = tables[1].querySelector('tr')
			
			assertFatal(!!lateAbsenceTableRows, `parseAbsences: !!lateAbsenceTableRows (was ${undefined})`)
			assertFatal(lateAbsenceTableRows.length >= 3, `parseAbsences: lateAbsenceTableRows.length >= 3 (was ${lateAbsenceTableRows.length})`)
			
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
				const lateAbsenceFields = lateAbsenceRow.querySelector('td')
				
				assertFatal(!!lateAbsenceFields, `parseAbsences: !!lateAbsenceFields (was ${undefined})`)
				assertFatal(lateAbsenceFields.length == 5, `parseAbsences: lateAbsenceFields.length == 5 (was ${lateAbsenceFields.length})`)
				for(let i = 0; i < lateAbsenceFields.length; i++) assertFatal(!!lateAbsenceFields[i], `parseAbsences: !!lateAbsenceFields[${i}] (was ${undefined})`)
				
				const lateAbsence: Partial<LateAbsenceObj> = {}
				
				lateAbsence.id = generateUUID()
				
				let lateAbsenceDateHTML = lateAbsenceFields[0].innerText()?.replaceAll('(*)', '')?.trim()
				assertFatal(!!lateAbsenceDateHTML, `parseAbsences: !!lateAbsenceDateHTML (was ${lateAbsenceDateHTML != undefined ? '\'\'' : undefined})`)
				const commaSeparated = lateAbsenceDateHTML.split(',')
				assertFatal(commaSeparated.length == 2, `parseAbsences: commaSeparated.length == 2 (was ${commaSeparated.length})`)
				lateAbsenceDateHTML = commaSeparated[1].trim()
				const lateAbsenceTimeHTML = lateAbsenceFields[1].innerText()?.trim()
				assertFatal(!!lateAbsenceTimeHTML, `parseAbsences: !!lateAbsenceTimeHTML (was ${lateAbsenceTimeHTML != undefined ? '\'\'' : undefined})`)
				lateAbsence.date = parseDate(`${lateAbsenceDateHTML} ${lateAbsenceTimeHTML}`, 'dd.MM.yyyy HH:mm')
				assertFatal(!!lateAbsence.date, `parseAbsences: !!lateAbsence.date (was ${undefined})`)
				
				lateAbsence.reason = lateAbsenceFields[2].innerText()?.trim()
				assertFatal(lateAbsence.reason != undefined, `parseAbsences: lateAbsence.reason != undefined (was ${undefined})`)
				
				const timespan = lateAbsenceFields[3].innerText()?.trim()
				assertFatal(!!timespan, `parseAbsences: !!timespan (was ${timespan != undefined ? '\'\'' : undefined})`)
				lateAbsence.timespan = parseInt(timespan)
				assertFatal(!isNaN(lateAbsence.timespan), `parseAbsences: !isNaN(lateAbsence.timespan) (was ${NaN})`)
				
				const excused = lateAbsenceFields[4].innerText()?.trim()
				assertFatal(!!excused, `parseAbsences: !!excused (was ${excused != undefined ? '\'\'' : undefined})`)
				lateAbsence.excused = excused === 'Ja'
				
				lateAbsences.push(lateAbsence as LateAbsenceObj)
			}
		}
		
		return { absences, absenceReports, openAbsences, lateAbsences } as Partial<UserObj>
	},
	
	parseGrades(content: string) {
		assertError(!!content, `parseGrades: !!content (was ${content != undefined ? '\'\'' : undefined})`)
		
		let dom: DOMObject | undefined
		
		try {
			dom = DOMObject.parse(content)
		} catch(error) {
			assertError(false, `parseGrades: DOMObject.parse(content) errored (threw '${error}')`)
		}
		
		assertError(!!dom, `parseGrades: !!dom (was ${undefined})`)
		
		dom = dom as DOMObject
		
		const subjectRows = dom.querySelector('#uebersicht_bloecke > page > div > table > tbody > tr')
		
		assertFatal(!!subjectRows, `parseGrades: !!subjectRows (was ${undefined})`)
		assertFatal(subjectRows.length >= 1, `parseGrades: subjectRows.length >= 1 (was ${subjectRows.length})`)
		for(let i = 0; i < subjectRows.length; i++) assertFatal(!!subjectRows[i], `parseGrades: !!subjectRows[${i}] (was ${undefined})`)
		
		subjectRows.shift()
		
		const subjects: SubjectObj[] = []
		const grades: GradeObj[] = []
		
		for(let subjectRowIndex = 0; subjectRowIndex < subjectRows.length; subjectRowIndex++) {
			const subjectRow = subjectRows[subjectRowIndex]
			const subjectFields = subjectRow.querySelector('td')
			
			assertFatal(!!subjectFields, `parseGrades: !!subjectFields (was ${undefined})`)
			assertFatal(subjectFields.length == 5, `parseGrades: subjectFields.length == 5 (was ${subjectFields.length})`)
			for(let i = 0; i < subjectFields.length; i++) assertFatal(!!subjectFields[i], `parseGrades: !!subjectFields[${i}] (was ${undefined})`)
			
			const subject: Partial<SubjectObj> = {}
			
			subject.id = generateUUID()
			
			const b = subjectFields[0].querySelector('b')
			assertFatal(!!b, `parseGrades: !!b (was ${undefined})`)
			assertFatal(b.length == 1, `parseGrades: b.length == 1 (was ${b.length})`)
			for(let i = 0; i < b.length; i++) assertFatal(!!b[i], `parseGrades: !!b[${i}] (was ${undefined})`)
			
			subject.abbreviation = b[0].innerText()?.trim()
			assertFatal(subject.abbreviation != undefined, `parseGrades: subject.abbreviation != undefined (was ${undefined})`)
			
			subject.name = subjectFields[0].innerText()?.trim()
			assertFatal(subject.name != undefined, `parseGrades: subject.name != undefined (was ${undefined})`)
			
			subject.hiddenGrades = subjectFields[1].innerText()?.includes('*') ?? false
			
			const a = subjectFields[3].querySelector('a')
			assertFatal(!!a, `parseGrades: !!a (was ${undefined})`)
			
			subject.gradesConfirmed = a.length <= 0
			
			subjects.push(subject as SubjectObj)
			
			let gradesRow: DOMObject[]
			const gradeRows: DOMObject[] = []
			while(subjectRowIndex + 1 < subjectRows.length && subjectRows[subjectRowIndex + 1].getAttribute('class')?.includes('detailrow')) {
				subjectRowIndex++
				
				if((gradesRow = subjectRows[subjectRowIndex].querySelector('table')) && gradesRow.length == 1 && gradesRow[0]) {
					const rows = gradesRow[0].querySelector('tr')
					
					assertFatal(!!rows, `parseGrades: !!rows (was ${undefined})`)
					gradeRows.push(...rows)
				}
			}
			
			if(gradeRows.length > 0) {
				assertFatal(gradeRows.length >= 2, `parseGrades: gradeRows.length >= 2 (was ${gradeRows.length})`)
				for(let i = 0; i < gradeRows.length; i++) assertFatal(!!gradeRows[i], `parseGrades: !!gradeRows[${i}] (was ${undefined})`)
				
				gradeRows.shift()
				
				let gradeTotal = 0
				let weightTotal = 0
				
				for(let gradeRowIndex = 0; gradeRowIndex < gradeRows.length; gradeRowIndex++) {
					const gradeRow = gradeRows[gradeRowIndex]
					const gradeFields = gradeRow.querySelector('td')
					
					assertFatal(!!gradeFields, `parseGrades: !!gradeFields (was ${undefined})`)
					if(gradeFields.length == 2 && gradeRowIndex + 1 == gradeRows.length) continue
					assertFatal(gradeFields.length == 4, `parseGrades: gradeFields.length == 4 (was ${gradeFields.length})`)
					for(let i = 0; i < gradeFields.length; i++) assertFatal(!!gradeFields[i], `parseGrades: !!gradeFields[${i}] (was ${undefined})`)
					
					const grade: Partial<GradeObj> = {}
					
					grade.id = generateUUID()
					
					grade.subjectId = subject.id
					
					const gradeDateHTML = gradeFields[0].innerText()?.trim()
					if(gradeDateHTML) {
						grade.date = parseDate(`${gradeDateHTML}`, 'dd.MM.yyyy')
						assertWarn(!!grade.date, `parseGrades: !!grade.date (was ${undefined})`)
					}
					
					grade.topic = gradeFields[1].innerText()?.trim()
					assertFatal(grade.topic != undefined, `parseGrades: grade.topic (was ${undefined})`)
					
					const gradeHTML = gradeFields[2].innerText()?.trim()
					grade.grade = gradeHTML ? parseFloat(gradeHTML) : undefined
					if(grade.grade != undefined && isNaN(grade.grade)) grade.grade = undefined
					
					const detailsDiv = gradeFields[2].querySelector('div')
					if(detailsDiv && detailsDiv.length == 1 && detailsDiv[0]) grade.details = detailsDiv[0].innerText()?.trim()
					
					grade.weight = parseFloat(gradeFields[3].innerText()?.trim())
					assertFatal(!isNaN(grade.weight), `parseGrades: !isNaN(grade.weight) (was ${NaN})`)
					
					if(grade.grade) {
						const weight = grade.weight ?? 1
						gradeTotal += grade.grade * weight
						weightTotal += weight
					}
					
					grades.push(grade as GradeObj)
				}
				
				subject.average = weightTotal > 0 ? gradeTotal / weightTotal : undefined
			}
			
			if(subjectRowIndex + 1 < subjectRows.length && subjectRows[subjectRowIndex + 1].getAttribute('id')?.includes('schueleruebersicht_verlauf')) subjectRowIndex++
		}
		
		return { subjects, grades } as Partial<UserObj>
	},
} as const

/********\
| Linker |
\********/

const link = (user: UserObj) => {
	const teacherTable: { [ key: string ]: TeacherObj } = {}
	const subjectTable: { [ key: string ]: SubjectObj } = {}
	
	const subjectIdTable = new Map<UniqueId, SubjectObj>()
	const absenceIdTable = new Map<UniqueId, AbsenceObj>()
	
	for(const teacher of user.teachers) {
		teacherTable[teacher.abbreviation] = teacher
	}
	
	for(const subject of user.subjects) {
		subjectTable[subject.abbreviation] = subject
		subjectIdTable.set(subject.id, subject)
		
		assertFatal(!!subject.abbreviation, `link (subjects): !!subject.abbreviation (was ${subject.abbreviation != undefined ? '\'\'' : undefined})`)
		const [ , , teacherAbbreviation ] = subject.abbreviation.split('-')
		assertFatal(!!teacherAbbreviation, `link (subjects): !!teacherAbbreviation (was ${teacherAbbreviation != undefined ? '\'\'' : undefined})`)
		
		const teacher = teacherTable[teacherAbbreviation]
		assertInfo(!!teacher, `link (subjects): !!teacher (was ${undefined})`)
		if(!teacher) continue
		
		subject.teacherId = teacher.id
		if(!teacher.subjectIds) teacher.subjectIds = []
		teacher.subjectIds.push(subject.id)
	}
	
	for(const grade of user.grades) {
		const subject = subjectIdTable.get(grade.subjectId)
		assertFatal(!!subject, `link (grades): !!subject (was ${undefined})`)
		
		if(!subject) continue
		
		if(!subject.gradeIds) subject.gradeIds = []
		subject.gradeIds.push(grade.id)
	}
	
	for(const openAbsence of user.openAbsences) {
		const subject = subjectTable[openAbsence.lessonAbbreviation]
		assertInfo(!!subject, `link (openAbsences): !!subject (was ${undefined})`)
		if(!subject) continue
		
		openAbsence.subjectId = subject.id
		if(!subject.openAbsenceIds) subject.openAbsenceIds = []
		subject.openAbsenceIds.push(openAbsence.id)
	}
	
	for(const absence of user.absences) absenceIdTable.set(absence.id, absence)
	
	for(const absenceReport of user.absenceReports) {
		const subject = subjectTable[absenceReport.lessonAbbreviation]
		assertInfo(!!subject, `link (absenceReports): !!subject (was ${undefined})`)
		if(subject) {
			if(!subject.absenceReportIds) subject.absenceReportIds = []
			subject.absenceReportIds.push(absenceReport.id)
			absenceReport.subjectId = subject.id
		}
		
		const absence = absenceIdTable.get(absenceReport.absenceId)
		assertFatal(!!absence, `link (absenceReports): !!absence (was ${undefined})`)
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
	}
}

type JoinFunction<T> = (item: Objectify<T>, user: User) => void

const Joiner = {
	joinAbsence: ((item, user) => {
		const absence = Absence.create(item)
		user.absences.push(absence)
		absence.link()
	}) as JoinFunction<Absence>,
	
	joinAbsenceReport: ((item, user) => {
		const absenceReport = AbsenceReport.create(item)
		user.absenceReports.push(absenceReport)
		absenceReport.link()
	}) as JoinFunction<AbsenceReport>,
	
	joinOpenAbsence: ((item, user) => {
		const openAbsence = OpenAbsence.create(item)
		user.openAbsences.push(openAbsence)
		openAbsence.link()
	}) as JoinFunction<OpenAbsence>,
	
	joinLateAbsence: ((item, user) => {
		const lateAbsence = LateAbsence.create(item)
		user.lateAbsences.push(lateAbsence)
		lateAbsence.link()
	}) as JoinFunction<LateAbsence>,
	
	joinSubject: ((item, user) => {
		const subject = Subject.create(item)
		user.subjects.push(subject)
		subject.link()
	}) as JoinFunction<Subject>,
	
	joinGrade: ((item, user) => {
		const grade = Grade.create(item)
		user.grades.push(grade)
		grade.link()
	}) as JoinFunction<Grade>,
	
	joinStudent: ((item, user) => {
		const student = Student.create(item)
		user.students.push(student)
		student.link()
	}) as JoinFunction<Student>,
	
	joinTeacher: ((item, user) => {
		const teacher = Teacher.create(item)
		user.teachers.push(teacher)
		teacher.link()
	}) as JoinFunction<Teacher>,
	
	joinTransaction: ((item, user) => {
		const transaction = Transaction.create(item)
		user.transactions.push(transaction)
		transaction.link()
	}) as JoinFunction<Transaction>,
} as const

/*********\
| Testing |
\*********/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function run(provider: string, username: string, password: string) {
	let user = {} as Partial<UserObj>
	
	const session = new Session(provider, username, password)
	await session.login()
	
	let html = await session.fetchPage(Pages.ABSENCES, true, { action: 'toggle_abs_showall' })
	if(html) user = { ...user, ...Parser.parseAbsences(html) }
	
	html = await session.fetchPage(Pages.GRADES, true)
	if(html) user = { ...user, ...Parser.parseGrades(html) }
	
	html = await session.fetchPage(Pages.TRANSACTIONS, true)
	if(html) user = { ...user, ...Parser.parseTransactions(html) }
	
	await session.fetchPage(Pages.TEACHERS, true)
	
	let csv = await session.fetchPage(Pages.DOCUMENT_DOWNLOAD, false, { tblName: 'Lehrerliste', 'export_all': 1 })
	if(csv) user = { ...user, ...Parser.parseTeachers(csv) }
	
	await session.fetchPage(Pages.STUDENTS, true)
	
	csv = await session.fetchPage(Pages.DOCUMENT_DOWNLOAD, false, { tblName: 'Kursliste', 'export_all': 1 })
	if(csv) user = { ...user, ...Parser.parseStudents(csv) }
	
	await session.logout()
	
	link(user as UserObj)
	
	const processed: User = {
		absences: [],
		absenceReports: [],
		openAbsences: [],
		lateAbsences: [],
		subjects: [],
		grades: [],
		students: [],
		teachers: [],
		transactions: [],
	}
	
	for(const absence of user.absences ?? []) Joiner.joinAbsence(absence, processed)
	for(const absenceReport of user.absenceReports ?? []) Joiner.joinAbsenceReport(absenceReport, processed)
	for(const openAbsence of user.openAbsences ?? []) Joiner.joinOpenAbsence(openAbsence, processed)
	for(const lateAbsence of user.lateAbsences ?? []) Joiner.joinLateAbsence(lateAbsence, processed)
	for(const subject of user.subjects ?? []) Joiner.joinSubject(subject, processed)
	for(const grade of user.grades ?? []) Joiner.joinGrade(grade, processed)
	for(const student of user.students ?? []) Joiner.joinStudent(student, processed)
	for(const teacher of user.teachers ?? []) Joiner.joinTeacher(teacher, processed)
	for(const transaction of user.transactions ?? []) Joiner.joinTransaction(transaction, processed)
	
	return processed
}

//Confirm Grade (index starts with 0): https://ksw.nesa-sg.ch/index.php?pageid=21311&action=nvw_bestaetigen&id=66fb5304d45d7068&transid=e9a99d&listindex=1

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

export type Lesson = {
	startDate: number
	endDate: number
	text: string
	comment?: string
	shortText?: string
	subjectAbbreviation?: string
	room?: string
	color: string
}
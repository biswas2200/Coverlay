// The resume as the Builder and Lay AI keep it (docs/prototype-spec.md, RB-DATA). Rich fields hold the small markup
// subset (<b>, <i>, <u>, <a href>, <font color>); the name, dates and skills are plain text.
export interface ExperienceEntry {
  role: string;
  dates: string;
  details: string;
}

export interface EducationEntry {
  degree: string;
  dates: string;
}

export interface Resume {
  name: string;
  contact: string;
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  /** Custom sections: free-form titles, text, bullets and tables (editor nodes). */
  extra?: { title: string; body: unknown[] }[];
}

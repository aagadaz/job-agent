export interface JobDetail{
    title : string;
    description: string;
    salary: string;
    employmentType: string;
    datePosted: string;
    company : string;
    location :string;
    url: string;
    source: string; // 'adzuna', 'greenhouse', 'lever', 'ashby'
    qualifications:string;
}

export interface OfferScore{
    score : number;
    verdict : 'Postuler' | 'À étudier' | 'Ignorer';
    justification : string;
    strengths : string[];
    missingSkills : string[];

}

export interface ScoredOffer extends JobDetail{
    scoring : OfferScore | null;

}


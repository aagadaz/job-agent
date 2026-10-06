export interface JobDetail{
    title : string;
    description: string;
    salary: string;
    employmentType: string;
    datePosted: string;
    company : string;
    location :string;
    url: string;
}

export interface OfferScore{
    score : number;
    verdict : 'Postuler' | 'A étudier' | 'Ignorer';
    justification : string;
    strengths : string[];
    missingskills : string[];

}

export interface ScoredOffer extends JobDetail{
    scoring : OfferScore | null;

}


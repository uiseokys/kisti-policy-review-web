import type {Assignment} from './contracts';
import {teamAllocation} from './allocation';
export function initialReviewMode(rows:Pick<Assignment,'mode'|'roleCode'>[]):Assignment['mode']{
 if(rows.some(row=>row.mode==='official'))return 'official';
 return rows.some(row=>row.mode==='balanced'&&teamAllocation(row.roleCode))?'balanced':'official';
}

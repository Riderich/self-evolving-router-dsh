// Synthetic unit-test requests. These are not InterCode benchmark observations.
// Supply INTERCODE_DATA_FILE explicitly to rerun against a separately obtained dataset.
import {readFile} from 'node:fs/promises'
const requests={0:'Find duplicate content hashes of java files',17:'Show first 16 bytes as hexadecimal',20:'Total lines in *.c files',22:'Sum lines in *.php files',28:'How many lines in *.php files',33:'Count all visible regular files',40:'Give lines total for *.php files',53:'Find repeated file names ignoring case',56:'Find line total for *.java files',8:'Change permissions of files',15:'Copy files from dir1',23:'Count nonempty php lines',39:'Count nonempty c lines',58:'Find files with sticky permission'}
export const data=process.env.INTERCODE_DATA_FILE?JSON.parse(await readFile(process.env.INTERCODE_DATA_FILE,'utf8')):Array.from({length:60},(_,i)=>({query:requests[i]??`Synthetic unused request ${i}`}))

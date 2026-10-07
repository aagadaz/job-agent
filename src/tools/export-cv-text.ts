import 'dotenv/config';
import fs from 'fs';
import { extractCVText } from '../lib/cv-analyzer';

// Extrait le texte du CV PDF dans cv.txt, à copier dans le secret GitHub CV_TEXT.
const CV_PATH = process.env.CV_PATH ?? './CV_AfzalAgadazi.pdf';

async function main() {
  const text = await extractCVText(CV_PATH);
  fs.writeFileSync('cv.txt', text, 'utf8');
  console.log(`✅ cv.txt écrit (${text.length} caractères). Copie-le dans le secret CV_TEXT, puis supprime le fichier.`);
}

main().catch(err => {
  console.error('ERREUR :', err);
  process.exit(1);
});

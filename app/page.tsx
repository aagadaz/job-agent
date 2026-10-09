import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/offers'); // la page des offres redirige elle-même vers /login si besoin
}

import { Link } from '@tanstack/react-router';
import { ArrowRight, ChartNoAxesColumnIncreasing, ShieldCheck, UsersRound } from 'lucide-react';

import aboutArtwork from '@/assets/nox-about-reference.png';
import './about-nox.css';

const benefits = [
  { icon: ShieldCheck, firstLine: 'Mais agilidade', secondLine: 'para você' },
  { icon: UsersRound, firstLine: 'Mais oportunidades', secondLine: 'de locação' },
  { icon: ChartNoAxesColumnIncreasing, firstLine: 'Um mercado imobiliário', secondLine: 'mais eficiente' },
];

export function AboutNoxSection() {
  return (
    <section className="nox-about" aria-labelledby="nox-about-title">
      <div className="nox-about__ambient" aria-hidden="true" />
      <div className="nox-about__layout">
        <div className="nox-about__copy">
          <div className="nox-about__eyebrow">
            <span>Sobre a NOX Fiança</span>
          </div>
          <h2 id="nox-about-title" className="nox-about__title">
            Uma nova forma de{' '}
            <span>garantir o aluguel.</span>
          </h2>
          <div className="nox-about__description">
            <p>
              O seguro fiança da NOX foi desenvolvido para simplificar a jornada de locação, eliminando a necessidade de garantias tradicionais e burocráticas que travam o mercado imobiliário.
            </p>
            <p>
              Nossa plataforma utiliza tecnologia proprietária para realizar análises de crédito precisas e instantâneas, proporcionando agilidade para o inquilino e segurança para o proprietário do imóvel.
            </p>
          </div>
        </div>
        <div className="nox-about__artwork">
          <img
            src={aboutArtwork}
            alt="Casa NOX Fiança com simulação aprovada, análise de crédito, contratos assinados, garantia digital e segurança para a locação."
            width={1254}
            height={1254}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="nox-about__actions">
          <Link to="/seguro-fianca" className="nox-about__button">
            Conhecer o seguro fiança
            <ArrowRight size={21} strokeWidth={1.7} aria-hidden="true" />
          </Link>
          <ul className="nox-about__benefits" aria-label="Benefícios da NOX Fiança">
            {benefits.map(({ icon: Icon, firstLine, secondLine }) => (
              <li key={firstLine}>
                <Icon size={28} strokeWidth={1.8} aria-hidden="true" />
                <span>{firstLine}<br />{secondLine}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

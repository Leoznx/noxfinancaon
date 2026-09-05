import { Link } from '@tanstack/react-router';
import { ArrowRight, CreditCard, Monitor, Star, UserRound, Zap } from 'lucide-react';

import heroImage from '@/assets/nox-home-reference-hero.png';
import './home-hero.css';

const benefits = [
  { label: 'Sem fiador', icon: UserRound },
  { label: 'Sem caução', icon: CreditCard },
  { label: 'Aprovação rápida', icon: Zap },
  { label: '100% digital', icon: Monitor },
];

export function HomeHero() {
  return (
    <section className="nox-home-hero" aria-labelledby="home-hero-title">
      <div className="nox-home-hero__content">
        <p className="nox-home-hero__eyebrow">Aluguel mais simples, sem limites</p>
        <h1 id="home-hero-title" className="nox-home-hero__title">
          <span>Seu próximo</span>{' '}
          <span>aluguel, sem fiador</span>{' '}
          <span>e sem caução.</span>
          {' '}<strong>Aprovação em 1 minuto.</strong>
        </h1>
        <p className="nox-home-hero__description">
          Com a NOX Fiança, você aluga com mais liberdade,<br className="nox-home-hero__desktop-break" />
          {' '}segurança e agilidade. Tudo online, sem burocracia.
        </p>
        <div className="nox-home-hero__actions">
          <Link to="/consultas/nova" className="nox-home-hero__button nox-home-hero__button--primary">
            Solicitar análise gratuita <ArrowRight size={21} aria-hidden="true" />
          </Link>
          <Link to="/contato" className="nox-home-hero__button nox-home-hero__button--secondary">
            Falar com um especialista
          </Link>
        </div>
        <ul className="nox-home-hero__benefits" aria-label="Vantagens da NOX Fiança">
          {benefits.map(({ label, icon: Icon }) => (
            <li key={label}>
              <span className="nox-home-hero__benefit-icon"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
              {label}
            </li>
          ))}
        </ul>
        <div className="nox-home-hero__trust">
          <p>Confiança em todo o Brasil</p>
          <dl className="nox-home-hero__metrics">
            <div><dt>imóveis protegidos</dt><dd>+15 mil</dd></div>
            <div><dt>avaliação de clientes</dt><dd>4,9 <Star size={22} fill="currentColor" strokeWidth={0} aria-hidden="true" /></dd></div>
            <div><dt>processo digital</dt><dd>100%</dd></div>
          </dl>
        </div>
      </div>
      <div className="nox-home-hero__approval" aria-hidden="true">
        <span><Zap size={24} strokeWidth={1.7} /></span>
        <p>Aprovação em<br /><strong>1 minuto</strong></p>
        <p>100% online e sem<br />burocracia</p>
        <i />
      </div>
      <div className="nox-home-hero__visual">
        <img
          src={heroImage}
          alt="Casa contemporânea com piscina ao pôr do sol. NOX Fiança: aprovação em 1 minuto, mais de 15 mil imóveis protegidos e avaliação de clientes de 4,9. Mais que aluguel, novos começos."
          width={1672}
          height={941}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
      </div>
    </section>
  );
}

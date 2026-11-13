import Frame, { frameVars } from './Frame';

export default function CrossSite() {
  return <Frame src={frameVars().CROSS_SITE_SRC} />;
}

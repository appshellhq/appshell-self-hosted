import Frame, { frameVars } from './Frame';

export default function OwnOrigin() {
  return <Frame src={frameVars().OWN_ORIGIN_SRC} />;
}

import Frame, { frameVars } from './Frame';

export default function SameOrigin() {
  return <Frame src={frameVars().SAME_ORIGIN_SRC} />;
}

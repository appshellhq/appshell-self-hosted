import Frame, { frameVars, type SlotProps } from './Frame';

export default function SameOrigin(props: SlotProps) {
  return <Frame src={frameVars().SAME_ORIGIN_SRC} props={props} />;
}

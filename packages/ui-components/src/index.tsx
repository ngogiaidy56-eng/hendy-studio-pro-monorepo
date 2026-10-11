import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
export function Button({children,className='',...props}:PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>){return <button className={`hendy-button ${className}`.trim()} {...props}>{children}</button>}
export function Panel({children,className=''}:PropsWithChildren<{className?:string}>){return <section className={`hendy-panel ${className}`.trim()}>{children}</section>}

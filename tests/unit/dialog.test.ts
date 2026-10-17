import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Dialog } from '../../components/dialog';

it.each([
  {title:'Your Ballast account',description:undefined},
  {title:'Put some weight behind it',description:'Your capital backs real decisions on this Studio pool.'},
  {title:'Put your agent on the record',description:'A clear scope makes a fair decision possible.'},
])('gives the $title dialog a resolvable accessible name and description',({title,description})=>{
  const props={title,description,onClose:()=>{},children:'Form contents'};
  const markup=renderToStaticMarkup(createElement(Dialog,props));
  const heading=markup.match(/aria-labelledby="([^"]+)"/);
  expect(heading).not.toBeNull();
  expect(markup).toContain(`<h2 id="${heading![1]}">${title}</h2>`);
  if(description){
    const text=markup.match(/aria-describedby="([^"]+)"/);
    expect(text).not.toBeNull();
    expect(markup).toContain(`<p id="${text![1]}">${description}</p>`);
  }else expect(markup).not.toContain('aria-describedby');
});

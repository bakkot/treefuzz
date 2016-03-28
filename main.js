"use strict";

Array.prototype.includes = function(x){return this.indexOf(x) !== -1;};


class Type {}

function isType(t, allowRecursive = true) {
  return t instanceof Type || (typeof t === 'string' && t.slice(0, 2).match(/t_|v_/)) || (allowRecursive && typeof t === 'function');
}

class Product extends Type {
  constructor(args, meta = {}) {
    args.forEach(x => { // todo optional typechecking
      if (!isType(x)) {
        throw `${x} is of incorrect type`;
      }
    });

    super();
    this.items = args;
    this.meta = {};
    Object.assign(this.meta, meta);
  }

  toString() {
    return `Product(${this.items.map(v => typeof v === 'string' ? JSON.stringify(v) : v.toString()).join(', ')})`;
  }
}

class Union extends Type {
  constructor(args, meta = {}) {
    if (args.length === 0) {
      throw `Cannot construct empty union.`;
    }

    args.forEach(x => {
      if (!isType(x)) {
        throw `${x} is of incorrect type`;
      }
    });

    super();
    this.items = args;
    this.meta = {};
  }

  toString() {
    return `Union(${this.items.map(v => typeof v === 'string' ? JSON.stringify(v) : v.toString()).join(', ')})`;
  }
}

function isSingleton(t) {
  return (t instanceof Product || t instanceof Union) && t.items.length === 1;
}

function Maybe(t) {
  return new Union(['v__nothing', t]);
}


function List(t) {
  //return mu => new Maybe(new Product(t, mu));
  return mu => new Union(['v__empty_list', new Product([t, mu], {isList: true})]);
}


function recur(t, f) {
  if (!(t instanceof Type)) return;
  t.items.forEach(t => recur(t, f));
  t.items = t.items.map(f);
}

function resolve(t, n) {
  while (typeof t === 'function') {
    t = t(n);
  }
  return t;
}

class Def {
  constructor(name, t) {
    if (typeof name !== 'string') {
      throw 'The name of a definition must be a string'
    }
    if (typeof t === 'function') {
      t = resolve(t, name);
    }
    if (!(t instanceof Type)) {
      throw 'The type of a definition must be a Type'
    }

    t.meta.name = name;

    this.name = name;
    this.t = t;
  }

  toString() {
    return `${JSON.stringify(this.name)} := ${this.t}`;
  }
}

function build(defs) {
  defs.forEach(d => {
    if (!(d instanceof Def)) {
      throw `${d} is not a Def`;
    }
  });

  if (new Set(defs.map(d => d.name)).size !== defs.length) {
    throw 'Cannot redefine names';
  }

  const types = new Map; // name -> type

  const newName = (() => {
    const seenNames = new Set(defs.map(d => d.name));
    let nextName = 0;

    return () => {
      while (seenNames.has(`t_${nextName}`)) {
        ++nextName;
      }
      seenNames.add(`t_${nextName}`);
      return `t_${nextName}`;
    };
  })();

  function name(type) {
    let ret = newName();
    defs.push(new Def(ret, type));
    return ret;
  }

  function setMu(t) {
    if (typeof t === 'function') {
      const n = newName(); // todo consistent n vs name naming
      t = resolve(t, n);
      defs.push(new Def(n, t));
      return n;
    }
    if (typeof t === 'string') {
      return t;
    }
    t.items = t.items.map(setMu);
    return t;
  }

  for (let d of defs) {
    d.t = setMu(d.t);
  }

  // replace nested types with type names
  for (let d of defs) { // forEach is not appropriate since we are modifying defs
    d.t.items = d.t.items.map(t => {
      if (t instanceof Type) {
        return name(t);
      } else { // string
        return t;
      }
    });

    types.set(d.name, d.t);
  }

  // expand/dedup unions
  let touched = true;
  while (touched) { // todo this is very far from ideal. maybe reuse pattern below.
    touched = false;
    types.forEach((val, key) => {
      if (!(val instanceof Union)) return;

      if (val.items.includes(key)) {
        throw `Encountered union containing itself during expansion`;
      }

      let itemset = new Set();
      val.items.forEach(n => {
        let t = types.get(n);
        if (!(t instanceof Union)) {
          itemset.add(n);
        } else {
          touched = true;
          // expand sub-unions
          t.items.forEach(n => itemset.add(n));
        }
      });

      if (itemset.size === 0) {
        throw 'After expanding unions, some union is empty'; // not sure this is even reachable
      } else {
        val.items = Array.from(itemset);
      }
    });
  }


  // todo reduce duplication, remove unreachable types and types which produce nothing

  // todo remove cycles of singletons or aliases, ideally as part of removing types which produce nothing
  // todo alias types? which get removed in full
  // check for type names without bindings

  return types;
}




// takes a list of [val, weight] pairs and picks a value with probability proportional to its weight
function choose(choices) {
  let total = 0;
  choices.forEach(([_, w]) => {total += w});
  if (total === 0) return null;
  let r = Math.random();
  for (let i = 0; i < choices.length; ++i) {
    const t = choices[i][1] / total;
    if (r < t) return choices[i][0];
    r -= t;
  }
  throw 'unreachable';
}

function isValue(name) {
  return name.slice(0, 2) === 'v_';
}

function isUnit(t) {
  return t instanceof Product && t.items.length === 0;
}


// todo alow penalizing or setting size of specific nodes (i.e. yield / yield*)


function makeGen(types, countInternalNodes = false) {
  // check for cycles in unions/singletons
  for (let [key, val] of types) {
    if (!(val instanceof Union) && (countInternalNodes || !isSingleton(val))) {
      continue;
    }

    const checked = new Set();
    function check(n) {
      if (checked.has(n)) return;
      checked.add(n);
      if (n === key) {
        throw `Encountered union or singleton containing itself after expansion: ${key} = ${val}`;
      }
      let t = types.get(n);
      if (t instanceof Union) {
        t.items.forEach(check);
      } else if (isSingleton(t) && !countInternalNodes) {
        check(t.items[0]);
      }
    }
    val.items.forEach(check);
  }

  let table = new Map;
  let productIncrement = countInternalNodes ? 1 : 0;
  
  // returns the number of trees of size n constructible from the type named by t_name.
  function f_name(t_name, n) {
    if (isValue(t_name)) {
      return n === 1 ? 1 : 0;
    }
    return f_type(types.get(t_name), n);
  }

  function f_type(t, n) {
    if (n === 0) {
      return 0;
    }

    if (t === undefined) {
      throw 'Undefined type??? Should have been caught earlier...';
    }

    if (isUnit(t)) {
      return n === 1 ? 1 : 0;
    }

    const sig = t.toString();
    let t_table = table.get(sig);
    if (t_table === undefined) {
      t_table = [0];
      table.set(sig, t_table);
    }

    if (t_table[n] === null) {
      console.log(table)
      throw `Encountered cycle (${t}, ${n})! This should have been prevented earlier`;
    }
    if (t_table[n] === undefined) {
      t_table[n] = null;
       
      let sum = 0;
      if (t instanceof Product) {
        if (t.items.length === 1) {
          sum = f_name(t.items[0], n - productIncrement);
        } else {
          // todo special-case if any child is a value type or unit, possibly
          let subProd = new Product(t.items.slice(1));
          for (let i = 1; i < n - productIncrement; ++i) {
            sum += f_name(t.items[0], i) * f_type(subProd, n - productIncrement - i);
          }
        }
      } else {
        t.items.forEach(item => {sum += f_name(item, n);});
      }
      t_table[n] = sum;
      
    }
    return t_table[n];
  }


  function generate_name(t_name, n) {
    if (isValue(t_name)) {
      return n === 1 ? t_name : null;
    }
    return generate_type(types.get(t_name), n);
  }

  function generate_type(t, n) {
    if (t === undefined) {
      throw 'g: Undefined type??? Should have been caught earlier...';
    }

    if (isUnit(t)) {
      return n === 1 ? t : null;
    }

    if (t instanceof Product) {
      if (t.items.length === 1) {
        return new Product([generate_name(t.items[0], n - productIncrement)], t.meta);
      }

      let choices = [];
      let subProd = new Product(t.items.slice(1));
      for (let i = 1; i < n - productIncrement; ++i) {
        choices.push([i, f_name(t.items[0], i) * f_type(subProd, n - productIncrement - i)]);
      }
      const split = choose(choices);
      if (split === null) return null;
      const head = generate_name(t.items[0], split);
      const tail = generate_type(new Product(t.items.slice(1)), n - productIncrement - split);
      return new Product([head, ...tail.items], t.meta);
    } else {
      if (!(t instanceof Union)) throw `Neither Product nor Union`;

      if (t.items.length === 1) {
        return generate_name(t.items[0], n);
      }
      const choices = t.items.map((s, i) => [i, f_name(s, n)]);
      const index = choose(choices);
      if (index === null) return null;
      return generate_name(t.items[index], n);
    }
  }

  generate_name.table = table;

  return generate_name;
}



module.exports = {Product, Union, Maybe, List, Def, build, makeGen};

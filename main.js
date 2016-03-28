"use strict";

Array.prototype.includes = function(x){return this.indexOf(x) !== -1;};


class Type {}
const unit = new Type;
unit.toString = ()=>'unit';
unit.items = [];

function isType(t, allowRecursive = true) {
	return t instanceof Type || (typeof t === 'string' && t.slice(0, 2).match(/t_|v_/)) || (allowRecursive && typeof t === 'function');
}

class Product extends Type {
	constructor(...args) {
		if (args.length === 0) {
			return unit;
		}

		args.forEach(x => { // todo optional typechecking
			if (!isType(x)) {
				throw `${x} is of incorrect type`;
			}
		});

		super();
		this.items = args;
		this.type = 'Product';
	}

	toString() {
		return `Product(${this.items.map(v => typeof v === 'string' ? JSON.stringify(v) : v.toString()).join(', ')})`;
	}
}

class Union extends Type {
	constructor(...args) {
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
		this.type = 'Union';
	}

	toString() {
		return `Union(${this.items.map(v => typeof v === 'string' ? JSON.stringify(v) : v.toString()).join(', ')})`;
	}
}

function isSingleton(t) {
	return (t instanceof Product || t instanceof Union) && t.items.length === 1;
}

// todo "Label" type or similar, which must not be possible to use to get around restrictions

function Maybe(t) {
	return new Union(unit, t);
}


// todo metadata
function List(t) { // we are eventually going to need first-class lists, I expect... or just a list label?
	//return mu => new Maybe(new Product(t, mu));
	return mu => {let r = new Union('v__empty_list', new Product(t, mu)); r.isList = true; return r;};
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

		if (!(t instanceof Type) || t === unit) {
			throw 'The type of a definition must be a Type (other than unit)'
		}

		this.name = name;
		this.t = t;
	}

	toString() {
		return `${JSON.stringify(this.name)} := ${this.t}`;
	}
}

function build(...defs) {
	defs.forEach(d => {
		if (!(d instanceof Def)) {
			throw `${d} is not a Def`;
		}
	});

	if (new Set(defs.map(d => d.name)).size !== defs.length) {
		throw 'Cannot redefine names';
	}

	const types = new Map([['unit', unit]]); // name -> type

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
		if (type === unit) return 'unit';
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

	// check for cycles in unions/singletons - todo this maybe belongs in mkGen
	for (let [key, val] of types) {
		if (!(val instanceof Union) && !isSingleton(val)) {
			continue;
		}

		const checked = new Set();
		function check(n) {
			if (checked.has(n)) return;
			checked.add(n);
			if (n === key) {
				throw 'Encountered union or singleton containing itself after expansion';
			}
			let t = types.get(n);
			if (t instanceof Union || isSingleton(t)) {
				t.items.forEach(check);
			}
		}
		val.items.forEach(check);
	}

	// todo reduce duplication, remove unreachable types and types which produce nothing

	// todo remove cycles of singletons or aliases, ideally as part of removing types which produce nothing
	// todo alias types? which get removed in full
	// check for type names without bindings

	//return Array.from(types).filter(v => v[0] !== 'unit').map(v => new Def(...v));
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

function makeGen(types) {
	let table = new Map;
	
	function f_name(t_name, n) {
		if (t_name === 'unit' || t_name.slice(0, 2) === 'v_') {
			return n === 1 ? 1 : 0;
		}
		return f_type(types.get(t_name), n);
	}

	function f_type(t, n) {
		if (n === 0) {
			throw 'No empty types!';
		}

		if (t === undefined) {
			throw 'Undefined type??? Should have been caught earlier...';
		}

		const sig = t.toString();
		let t_table = table.get(sig);
		if (t_table === undefined) {
			t_table = [0];
			table.set(sig, t_table);
		}

		if (t_table[n] === null) {
			throw 'Encountered cycle! This should have been prevented earlier';
		}
		if (t_table[n] === undefined) {
			t_table[n] = null;
			if (isSingleton(t)) {
				t_table[n] = f_name(t.items[0], n);
			} else {
				let sum = 0;
				if (t instanceof Product) {
					// todo special-case if any child is a value type or unit, possibly
					let subProd = new Product(...t.items.slice(1));
					for (let i = 1; i < n; ++i) {
						sum += f_name(t.items[0], i) * f_type(subProd, n - i);
					}
				} else {
					// assert t instanceof Union;
					t.items.forEach(item => {sum += f_name(item, n);});
				}
				t_table[n] = sum;
			}
		}
		return t_table[n];
	}


	function generate_name(t_name, n) {
		if (t_name === 'unit' || t_name.slice(0, 2) === 'v_') {
			return n === 1 ? t_name : null;
		}
		return generate_type(types.get(t_name), n);
	}

	function generate_type(t, n) {
		if (t === undefined) {
			throw 'g: Undefined type??? Should have been caught earlier...';
		}

		//console.log('a', t.toString(), n)
		if (t instanceof Product) {
			if (t.items.length === 1) {
				//console.log('b', t.items[0], n)
				return new Product(generate_name(t.items[0], n));
			}

			let choices = [];
			let subProd = new Product(...t.items.slice(1));
			for (let i = 1; i < n; ++i) {
				choices.push([i, f_name(t.items[0], i) * f_type(subProd, n - i)]);
			}
			const split = choose(choices);
			//console.log('d', choices, split, n, t.toString())
			//console.log(table)
			if (split === null) return null;
			//console.log('c', n, split, new Product(...t.items.slice(1)).toString())
			const head = generate_name(t.items[0], split);
			const tail = generate_type(new Product(...t.items.slice(1)), n - split);
			return new Product(head, ...tail.items);
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


let S = build(
	new Def('t_start', new Product('t_0', 't_0', 't_0')),
	new Def('t_0', new List(new Union('v_0', 'v_1')))
);

//console.log(S)

let G = makeGen(S);

console.log(G('t_start', 5).toString());

//console.log(G.table)


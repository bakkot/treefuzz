"use strict";

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
	return t instanceof Product && t.items.length === 1;
}

// todo "Label" type or similar, which must not be possible to use to get around restrictions

function Maybe(t) {
	return new Union(unit, t);
}


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

	return Array.from(types).filter(v => v[0] !== 'unit').map(v => new Def(...v));
}


console.log(build(
	new Def('t_0', new List(new Union('v_0', 'v_1')))
	//new Def('t_1', mu => new Union(unit, new Union('v_0', new Product(unit, mu))))
	//new Def('t_0', new List(new Product('v_1', 'v_2')))
	// new Def('t_0', new Union(unit, 'v_0')),
	// new Def('t_1', new Union('v_1', new Product(unit, 't_1'), unit, 't_0')),
	// new Def('t_2', new Union(unit, 'v_2')),
	// new Def('t_3', new Product('v_3', new List('t_3')))
	//new Def('t_0', new Union('v_1', 'v_1'))
).map(t => t.toString()).join('\n'));





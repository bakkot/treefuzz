# Treefuzz

A work-in-progress package for randomly generating typed trees of fixed size.

The algorithm used is a generalization and simplification of the algorithm given in [Generating Strings at Random from a Context Free Grammar](http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.32.8707) by Bruce McKenzie.

Currently requires babel-node, because I haven't gotten around to building it.

## Types

For our purposes, a type is one of the following:

- A value type
- A product of zero or more types
- A union of one or more types

Types may be recursive, even mutually recursive. Note that unions are flat and are not disjoint: Union(a, b, Union(b, c, d)) is the same as Union(a, b, c, d).

### Defining types

Types are given names, and the name of a type may be used interchangeably with its value. The names of value types are prefixed by 'v\_'; these types do not need to be defined. The names of composite types are prefixed by 't\_' and do need to be defined.

You may write a type as `new Union([..])` or `new Product([...])`. The elements of the lists may be the names of other types, or unions or products themselves; see Example below. Intermediate types will be given names at build time. Products take an optional metadata object as a second field.

Additionally, to assist with constructing recursive types, you may define a type which refers to itself using a function: for example, `mu => new Union('v__empty_list', new Product('v_boolean', mu))` defines a list of booleans. These will be given names and evaluated at build time. This isn't necessary, since you could just name everything yourself, but it makes it easier to write type constructors like `List`.

`List` and `Maybe` convenience type constructors are provided:

```js
function Maybe(t) {
  return new Union(['v__nothing', t]);
}

function List(t) {
  return mu => new Union(['v__empty_list', new Product([t, mu], {isList: true})]);
}
```

Observe that the empty list will count as a leaf in a tree, so that there are no trees without leaves.


Types are assigned names by creating definitions: `new Def('name', type)`.


## Fuzzing

The `build` function takes a list of definitions of the format described above and gives names to all intermediate and recursive types, so that every non-value type is a product or union of type names. The output of this function is passed to `makeGen`, which returns a function returning a random tree of the provided type and size every time you call it (or null if no such tree exists).

The nodes of the resulting trees are Products or value types. Products have an 'items' field containing their children and a 'meta' field which is an object with a 'name' field giving the original name of the type (which may be nonsensical if the type was not originally given a name) and any other fields given to the original type constructor.


## Example

See [shift.js](shift.js) for a real-life example.

Here we generate three lists of bits whose combined length is 16 uniformly among all such triples.

```js
// The type of tuples of three lists of bits
let types = build([
  new Def('t_three_lists', new Product(['t_bit_list', 't_bit_list', 't_bit_list'])),
  new Def('t_bit_list', new List('v_bit'))
]);

let gen = makeGen(types);

let tree = gen('t_three_lists', 16 + 3); // + 3, since each list adds one to the size of the tree

console.log(fromTree(tree));
/*
Something like
{ a: [ 1, 0, 1, 0, 0 ],
  b: [ 0 ],
  c: [ 0, 0, 0, 0, 1, 1, 0, 0, 1, 0 ] }
*/


// Helper functions: turn the resulting Product tree into a tree of the desired form
function toList(v) {
  let list = [];
  while (v !== 'v__empty_list') {
    list.push(fromTree(v.items[0]));
    v = v.items[1];
  }
  return list;
}

function fromTree(t) {
  if (typeof t === 'string') {
    switch (t) {
      case 'v_bit':
        return Math.round(Math.random());
      case 'v__empty_list':
        return [];
      default:
        throw 'not reached';
    }
  }

  if (t.meta.isList) {
    return toList(t);
  }
  if (t.meta.name === 't_three_lists') {
    return {a: fromTree(t.items[0]), b: fromTree(t.items[1]), c: fromTree(t.items[2])};
  }
  throw 'not reached';
}
```


const {Product, Union, Maybe, List, Def, build, makeGen} = require('./main');
const Spec = require('shift-spec').default;
const AST = require('shift-ast/checked');
const {default: codegen, FormattedCodeGen} = require('shift-codegen')


const ExpressionType = Spec.ExpressionStatement.fields[2].type;
const StatementType = Spec.LabeledStatement.fields[3].type;
const VariableDeclarationKindType = Spec.VariableDeclaration.fields[2].type;
const CompoundAssignmentOperatorType = Spec.CompoundAssignmentExpression.fields[2].type;
const BinaryOperatorType = Spec.BinaryExpression.fields[2].type;
const UnaryOperatorType = Spec.UnaryExpression.fields[2].type;
const UpdateOperator = Spec.UpdateExpression.fields[3].type;

function printType(type, flattenUnion = false) {
  switch (type) {
    case ExpressionType:
      return 't_Expression';
    case StatementType:
      return 't_Statement';
    case VariableDeclarationKindType:
      return 'v_VarDeclKind';
    case CompoundAssignmentOperatorType:
      return 'v_CompoundAssignOp';
    case BinaryOperatorType:
      return 'v_BinOp';
    case UnaryOperatorType:
      return 'v_UnOp';
    case UpdateOperator:
      return 'v_UpdateOp';
  }
  switch (type.typeName) {
    case 'Boolean':
      return 'v_boolean';
    case 'Number':
      return 'v_number';
    case 'String':
      return 'v_string';
    case 'Maybe':
      return `t_Maybe(${printType(type.argument)})`;
    case 'List':
      return `t_List(${printType(type.argument)})`;
    case 'Union':
      let types = `${type.arguments.map(t=>printType(t, true)).sort().join(', ')}`;
      if (flattenUnion) {
        return types;
      }
      return `t_Union(${types})`;
    case 'Enum':
      return `v_{${type.values.map(x=>'"'+x+'"').join(', ')}}`;
    default:
      return `t_${type.typeName}`;
  }
}

let seen = new Set;
let defs = [];

function define(t) {
  const name = printType(t);
  if (seen.has(name) || name[0] === 'v') return name;
  seen.add(name);

  let rhs;
  switch (t.typeName) {
    case 'Maybe':
      rhs = new Maybe(define(t.argument));
      break;
    case 'List':
      rhs = new List(define(t.argument));
      break;
    case 'Union':
      rhs = new Union(t.arguments.map(define));
      break;
    default:
      rhs = new Product(t.fields.filter(f => f.name !== 'type' && f.name !== 'loc')
        .map(f => define(f.type)));
  }
  defs.push(new Def(name, rhs));
  return name;
}

function toList(v) {
  let list = [];
  while (v !== 'v__empty_list') {
    list.push(toTree(v.items[0]));
    v = v.items[1];
  }
  return list;
}

function toTree(t) {
  if (typeof t === 'string') {
    switch (t) {
      case 'v__empty_list':
        return [];
      case 'v__nothing':
        return null;
      case 'v_boolean':
        return Math.random() > 0.5;
      case 'v_number':
        return Math.round(Math.random()*10); // todo something less dumb
      case 'v_string':
        return 'a_string'; // todo something less dumb
      case 'v_VarDeclKind':
        return ['var', 'let', 'const'][Math.floor(3*Math.random())];
      case 'v_CompoundAssignOp':
        return ["+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "|=", "^=", "&="][Math.floor(11*Math.random())];
      case 'v_BinOp':
        return ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof", "<<", ">>", ">>>", "+", "-", "*", "/", "%", ",", "||", "&&", "|", "^", "&"][Math.floor(24*Math.random())];
      case 'v_UnOp':
        return ["+", "-", "!", "~", "typeof", "void", "delete"][Math.floor(7*Math.random())];
      case 'v_UpdateOp':
        return ["++", "--"][Math.floor(2*Math.random())];
      default:
        return t.slice(2);
    }
  }

  if (t.meta.isList) {
    return toList(t);
  }
  let typeName = t.meta.name.slice(2);
  let type = Spec[typeName];
  let obj = {};
  t.items.forEach((item, i) => {obj[type.fields[i+2].name] = toTree(item);}); // +2 to compensate for type & loc
  return new AST[typeName](obj);
}



define(Spec.Script);
//define(Spec.Module);


const gen = makeGen(build(defs), true);
let tree = toTree(gen('t_Script', 40));
console.log(codegen(tree, new FormattedCodeGen));

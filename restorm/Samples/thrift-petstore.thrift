namespace java com.example.petstore

include "common.thrift"

typedef i64 PetId

struct Tag {
  1: i32 id,
  2: string name
}

struct Pet {
  1: required PetId id,
  2: required string name,
  3: optional list<Tag> tags,
  4: optional PetStatus status
}

exception PetNotFoundException {
  1: string message
}

service PetService {
  Pet getPetById(1: PetId id) throws (1: PetNotFoundException notFound),
  list<Pet> listPets(),
  oneway void logAccess(1: string entry)
}
